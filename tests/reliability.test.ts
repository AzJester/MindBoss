import { describe, expect, it, vi, afterEach } from "vitest";
import { testDatabase, disposeTestDatabases } from "./support/database";
import { nextRecurrence, localInstant, entryDueDates } from "../shared/time";
import { serializeAiEntries } from "../shared/ai";
import { encryptString } from "../functions/api/_lib";
import webpush from "web-push";
import Papa from "papaparse";
import { sendDueReminders, purgeExpired } from "../workers/reminders";

afterEach(disposeTestDatabases);
describe("real SQLite migrations and Pages API", () => {
  it("returns numeric whole-library storage totals for empty and populated accounts", async () => {
    const { db, call } = await testDatabase();
    expect(await (await call("/stats")).json()).toEqual({
      entryCount: 0,
      activeCount: 0,
      attachmentCount: 0,
      attachmentBytes: 0,
    });
    for (const status of ["active", "archived", "trashed"]) {
      const id = crypto.randomUUID();
      await call("/entries", "POST", { id, kind: "note", title: status });
      await db
        .prepare("UPDATE entries SET status=? WHERE id=?")
        .run(status, id);
      await db
        .prepare(
          "INSERT INTO attachments(id,entry_id,r2_key,file_name,mime_type,size_bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          crypto.randomUUID(),
          id,
          "key-" + status,
          "file.png",
          "image/png",
          1048576,
          "hash-" + status,
          new Date().toISOString(),
        );
    }
    expect(await (await call("/stats")).json()).toEqual({
      entryCount: 3,
      activeCount: 1,
      attachmentCount: 3,
      attachmentBytes: 3145728,
    });
  });
  it("creates, searches, updates ordered tasks atomically and rejects stale writes", async () => {
    const { call } = await testDatabase();
    const id = crypto.randomUUID();
    let response = await call("/entries", "POST", {
      id,
      kind: "list",
      title: "Checklist",
      listItems: [
        {
          id: crypto.randomUUID(),
          text: "Unique search phrase",
          position: 0,
          completedAt: null,
          dueAt: null,
        },
      ],
    });
    expect(response.status).toBe(201);
    const entry = (await response.json()).entry;
    expect(entry.listItems[0].text).toBe("Unique search phrase");
    response = await call("/entries?q=Unique");
    expect(response.status).toBe(200);
    expect((await response.json()).entries).toHaveLength(1);
    response = await call("/entries/" + id, "PATCH", {
      version: entry.version,
      title: "Updated",
      listItems: [{ ...entry.listItems[0], text: "Saved task" }],
    });
    expect(response.status).toBe(200);
    response = await call("/entries/" + id, "PATCH", {
      version: entry.version,
      title: "Stale",
      listItems: [],
    });
    expect(response.status).toBe(409);
    const saved = (await (await call("/entries/" + id)).json()).entry;
    expect(saved.title).toBe("Updated");
    expect(saved.listItems[0].text).toBe("Saved task");
  });
  it("exports every record beyond 250 and uses inclusive local date filters", async () => {
    const { db, call, env } = await testDatabase();
    const statements = Array.from({ length: 302 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO entries(id,user_id,kind,title,created_at,updated_at) VALUES(?,127560421,'note',?,?,?)",
      ).bind(
        crypto.randomUUID(),
        "Entry " + i,
        "2026-09-09T05:00:00.000Z",
        "2026-09-09T05:00:00.000Z",
      ),
    );
    await env.DB.batch(statements);
    const exported = await (await call("/exports/json")).json();
    expect(exported.entries).toHaveLength(302);
    expect(exported.preferences.displayTimezone).toBe("America/Phoenix");
    const response = await call("/entries?from=2026-09-08&to=2026-09-08");
    expect(response.status).toBe(200);
    expect((await response.json()).entries).toHaveLength(100);
  });
  it("retains cleanup jobs and blocks deleted captures from resurrection", async () => {
    const { call, db, setDeleteFailure, env } = await testDatabase();
    const id = crypto.randomUUID();
    let entry = (
      await (
        await call(
          "/entries",
          "POST",
          { id, kind: "note", body: "Delete me" },
          { "idempotency-key": id },
        )
      ).json()
    ).entry;
    entry = (
      await (
        await call("/entries/" + id, "PATCH", {
          version: entry.version,
          status: "trashed",
        })
      ).json()
    ).entry;
    await db
      .prepare(
        "INSERT INTO attachments(id,entry_id,r2_key,file_name,mime_type,size_bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        crypto.randomUUID(),
        id,
        "file-key",
        "example.png",
        "image/png",
        10,
        "hash",
        new Date().toISOString(),
      );
    setDeleteFailure(true);
    expect(
      (
        await call(
          "/entries/" + id + "?permanent=true&version=" + entry.version,
          "DELETE",
        )
      ).status,
    ).toBe(204);
    expect(
      await db.prepare("SELECT * FROM attachment_cleanup").all(),
    ).toHaveLength(1);
    expect(
      (
        await call(
          "/entries",
          "POST",
          { id, kind: "note", body: "Old offline copy" },
          { "idempotency-key": id },
        )
      ).status,
    ).toBe(410);
    setDeleteFailure(false);
    await purgeExpired(env as never);
    expect(
      await db.prepare("SELECT * FROM attachment_cleanup").all(),
    ).toHaveLength(0);
    const restoredId = crypto.randomUUID();
    await call("/entries", "POST", {
      id: restoredId,
      kind: "note",
      body: "Restored during cleanup",
    });
    await db
      .prepare(
        "UPDATE entries SET status='trashed',deleted_at='2020-01-01' WHERE id=?",
      )
      .run(restoredId);
    const originalBatch = env.DB.batch.bind(env.DB);
    let first = true;
    const concurrentEnv = {
      ...env,
      DB: new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (first) {
                first = false;
                await db
                  .prepare(
                    "UPDATE entries SET status='active',deleted_at=NULL WHERE id=?",
                  )
                  .run(restoredId);
              }
              return originalBatch(statements);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    await purgeExpired(concurrentEnv as never);
    expect(
      await db.prepare("SELECT status FROM entries WHERE id=?").get(restoredId),
    ).toMatchObject({ status: "active" });
    expect(
      await db
        .prepare("SELECT id FROM deleted_entry_ids WHERE id=?")
        .get(restoredId),
    ).toBeNull();
  });
  it("retries the fifth attachment without creating duplicates", async () => {
    const { call } = await testDatabase();
    const id = crypto.randomUUID();
    await call("/entries", "POST", { id, kind: "note", title: "Files" });
    const form = (index: number) => {
      const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index]);
      const body = new FormData();
      body.append("file", new File([data], "image.png", { type: "image/png" }));
      return body;
    };
    for (let i = 0; i < 5; i++)
      expect(
        (await call("/entries/" + id + "/attachments", "POST", form(i))).status,
      ).toBe(201);
    const response = await call(
      "/entries/" + id + "/attachments",
      "POST",
      form(4),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).entry.attachments).toHaveLength(5);
  });
  it("saves appearance independently of legacy invalid quiet hours", async () => {
    const { call, db } = await testDatabase();
    await call("/preferences", "PATCH", {
      defaultCaptureKind: "list",
      weeklyReviewDay: 3,
      quietStart: "21:00",
      quietEnd: "07:00",
    });
    for (const [quietStart, quietEnd] of [
      ["21:00", "21:00"],
      ["21:00", null],
      [null, "07:00"],
    ]) {
      await db
        .prepare("UPDATE user_preferences SET quiet_start=?, quiet_end=?")
        .run(quietStart, quietEnd);
      for (const changes of [
        { theme: "light" },
        { fontFamily: "classic" },
        { displayTimezone: "UTC" },
        { compactView: true },
      ]) {
        const response = await call("/preferences", "PATCH", changes);
        expect(response.status).toBe(200);
        const saved = (await response.json()).preferences;
        expect(saved).toMatchObject({
          ...changes,
          quietStart,
          quietEnd,
          defaultCaptureKind: "list",
          weeklyReviewDay: 3,
        });
      }
    }
    const saved = (await (await call("/preferences")).json()).preferences;
    expect(saved).toMatchObject({
      theme: "light",
      fontFamily: "classic",
      displayTimezone: "UTC",
      compactView: true,
    });
    for (const changes of [
      { quietStart: "21:00", quietEnd: "21:00" },
      { quietStart: "21:00", quietEnd: null },
      { quietStart: null, quietEnd: "07:00" },
    ]) {
      const response = await call("/preferences", "PATCH", changes);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("quiet_hours_invalid");
    }
    expect(
      (await call("/preferences", "PATCH", { quietStart: "21:00" })).status,
    ).toBe(200);
    expect(
      (
        await call("/preferences", "PATCH", {
          quietStart: null,
          quietEnd: null,
        })
      ).status,
    ).toBe(200);
  });
  it("validates quiet hours, CSRF and repeatable backup restore", async () => {
    const { call } = await testDatabase();
    expect(
      (await call("/preferences", "PATCH", { quietStart: "19:00" })).status,
    ).toBe(400);
    expect(
      (
        await call("/preferences", "PATCH", {
          quietStart: "19:00",
          quietEnd: "07:00",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "/entries",
          "POST",
          { id: crypto.randomUUID(), kind: "note", body: "Blocked" },
          { "x-csrf-token": "" },
        )
      ).status,
    ).toBe(403);
    const id = crypto.randomUUID(),
      createdAt = "2023-01-30T22:00:00.000Z";
    const tagId = crypto.randomUUID(),
      parentId = crypto.randomUUID(),
      rootId = crypto.randomUUID();
    const entry = {
      id,
      kind: "list",
      title: "Restored",
      body: "",
      source: "chrome_extension",
      sourceUrl: "https://example.com",
      status: "archived",
      createdAt,
      updatedAt: createdAt,
      pinnedAt: createdAt,
      listItems: [
        {
          id: crypto.randomUUID(),
          text: "Do it",
          position: 0,
          dueAt: createdAt,
          completedAt: createdAt,
        },
      ],
      tags: [{ id: tagId, name: "CHILD" }],
      attachments: [],
    };
    const tags = [
      {
        id: tagId,
        name: "CHILD",
        parentId,
        triggers: ["keyword"],
        color: "#08795f",
      },
      { id: parentId, name: "PARENT", parentId: rootId },
      { id: rootId, name: "ROOT" },
    ];
    let response = await call("/import/backup", "POST", {
      entries: [entry],
      tags,
      restoreSettings: true,
      preferences: {
        boardTagIds: [tagId],
        displayTimezone: "America/New_York",
      },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).created).toEqual([id]);
    response = await call("/import/backup", "POST", { entries: [entry] });
    expect((await response.json()).skipped).toEqual([id]);
    const result = (await (await call("/entries/" + id)).json()).entry;
    expect(result.createdAt).toBe(createdAt);
    expect(result.listItems[0].completedAt).toBe(createdAt);
    expect(result.status).toBe("archived");
    expect(result.sourceUrl).toBe("https://example.com");
    const restoredTags = (await (await call("/tags")).json()).tags;
    const child = restoredTags.find(
      (tag: { name: string }) => tag.name === "CHILD",
    );
    const parent = restoredTags.find(
      (tag: { name: string }) => tag.name === "PARENT",
    );
    const root = restoredTags.find(
      (tag: { name: string }) => tag.name === "ROOT",
    );
    expect(child.parentId).toBe(parent.id);
    expect(parent.parentId).toBe(root.id);
    expect(child.triggers).toEqual(["keyword"]);
    const backup = await (await call("/exports/json")).json();
    expect(backup.preferences.boardTagIds).toEqual([child.id]);
    expect(backup.timezone).toBe("America/New_York");

    // Feed our actual CSV export back through the actual importer in a fresh D1 database.
    const csv = Papa.parse<Record<string, string>>(
      await (await call("/exports/csv")).text(),
      { header: true, skipEmptyLines: true },
    );
    const record = JSON.parse(csv.data[0].record_json);
    const target = await testDatabase();
    const input = {
      ...record,
      tags: record.tags.map((tag: { name: string }) => tag.name),
      pinned: Boolean(record.pinnedAt),
      roundTrip: true,
    };
    const imported = await (
      await target.call("/import/mindchuk", "POST", { entries: [input] })
    ).json();
    expect(imported).toMatchObject({ created: 1, skipped: 0, errors: [] });
    expect(
      await (
        await target.call("/import/mindchuk", "POST", { entries: [input] })
      ).json(),
    ).toMatchObject({ created: 0, skipped: 1 });
    const roundTrip = (await (await target.call("/entries/" + id)).json())
      .entry;
    expect(roundTrip).toMatchObject({
      title: result.title,
      body: result.body,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      status: result.status,
      pinnedAt: result.pinnedAt,
      source: result.source,
      sourceUrl: result.sourceUrl,
    });
    expect(roundTrip.listItems).toEqual(result.listItems);
  });
});
describe("reminder scheduling", () => {
  it("uses Phoenix weekdays and retains month-end anchors", () => {
    expect(nextRecurrence("2026-09-12T03:00:00.000Z", "weekdays")).toBe(
      "2026-09-15T03:00:00.000Z",
    );
    expect(nextRecurrence("2026-02-01T03:00:00.000Z", "monthly")).toBe(
      "2026-03-01T03:00:00.000Z",
    );
    expect(
      nextRecurrence(
        "2026-03-01T03:00:00.000Z",
        "monthly",
        "America/Phoenix",
        new Date("2026-03-01T03:00:00Z"),
        31,
      ),
    ).toBe("2026-04-01T03:00:00.000Z");
    expect(
      nextRecurrence(
        "2026-01-01T16:00:00Z",
        "daily",
        "America/Phoenix",
        new Date("2026-09-08T17:00:00Z"),
      ),
    ).toBe("2026-09-09T16:00:00.000Z");
    expect(
      localInstant("2026-09-08", 9, 0, "America/Phoenix").toISOString(),
    ).toBe("2026-09-08T16:00:00.000Z");
  });
  it("retries only the failed device after partial delivery", async () => {
    const { call, db, env } = await testDatabase();
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await call("/entries", "POST", {
      id,
      kind: "reminder",
      title: "Due",
      reminderAt: new Date(Date.now() - 60000).toISOString(),
    });
    for (const endpoint of ["one", "two"])
      await db
        .prepare(
          "INSERT INTO push_subscriptions(id,user_id,endpoint_hash,subscription_ciphertext,created_at) VALUES(?,127560421,?,?,?)",
        )
        .run(
          endpoint,
          endpoint,
          await encryptString(
            env.PUSH_ENCRYPTION_KEY,
            JSON.stringify({
              endpoint,
              keys: { auth: "test", p256dh: "test" },
            }),
          ),
          now,
        );
    vi.spyOn(webpush, "setVapidDetails").mockImplementation(() => {});
    const send = vi
      .spyOn(webpush, "sendNotification")
      .mockResolvedValue({ statusCode: 201 } as never);
    send
      .mockImplementationOnce(async () => ({ statusCode: 201 }) as never)
      .mockRejectedValueOnce({ statusCode: 503 });
    await sendDueReminders(env as never);
    expect(
      (
        await db
          .prepare("SELECT reminder_state FROM entries WHERE id=?")
          .get(id)
      )?.reminder_state,
    ).toBe("pending");
    expect(
      await db.prepare("SELECT * FROM push_deliveries").all(),
    ).toHaveLength(1);
    await sendDueReminders(env as never);
    expect(send).toHaveBeenCalledTimes(3);
    expect(
      (
        await db
          .prepare("SELECT reminder_state FROM entries WHERE id=?")
          .get(id)
      )?.reminder_state,
    ).toBe("delivered");
    vi.restoreAllMocks();
  });
});
it("AI serialization includes exactly selected task metadata without truncation", () => {
  const entries = [
    {
      title: "List",
      body: "Text",
      tags: ["A"],
      listItems: [
        { text: "Task", dueAt: "2026-09-09T16:00:00Z", completedAt: null },
      ],
    },
  ];
  expect(JSON.parse(serializeAiEntries(entries))).toEqual(entries);
});
