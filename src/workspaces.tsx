import { useEffect, useState, type ReactNode } from "react";
import { unzipSync, strFromU8 } from "fflate";
import {
  Bell,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Pencil,
  X,
} from "lucide-react";
import type { Entry } from "../shared/types";
import { aiEntry, serializeAiEntries, AI_INPUT_LIMIT } from "../shared/ai";
import {
  getAiStatus,
  getEntries,
  runAi,
  createEntry,
  addAttachment,
  updateEntry,
  isLocalMode,
  remote,
  subscribeToPush,
  type AiStatus,
} from "./api";
import {
  acknowledgeOutbox,
  cacheValue,
  cachedValue,
  drainOutbox,
} from "./offline";
import { dateKey, entryDueDates } from "../shared/time";
import { formatDateTime } from "./reminders";
import { Modal } from "./ui";

export function EntryDetails({
  entry,
  timeZone,
  onClose,
  onEdit,
  onChange,
  onRemind,
}: {
  entry: Entry;
  timeZone: string;
  onClose: () => void;
  onEdit: () => void;
  onChange: (entry: Entry, changes: Record<string, unknown>) => Promise<void>;
  onRemind: (text: string, date: string | null) => void;
}) {
  return (
    <Modal
      label={entry.title || "Entry details"}
      onClose={onClose}
      className="detail-sheet"
    >
      <header className="detail-header">
        <div>
          <span className="eyebrow">
            {entry.kind} · {entry.status}
          </span>
          <h2>{entry.title || "Untitled entry"}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close entry"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <p className="detail-body">{entry.body}</p>
      {entry.sourceUrl && (
        <a
          className="source-link"
          href={entry.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={16} />
          {entry.sourceTitle || entry.sourceUrl}
        </a>
      )}
      {entry.listItems.length > 0 && (
        <div className="detail-tasks">
          <div className="detail-task-heading">
            <span>Task</span>
            <span>Due</span>
          </div>
          {entry.listItems.map((item) => (
            <div
              className={"detail-task " + (item.completedAt ? "complete" : "")}
              key={item.id}
            >
              <button
                className="task-complete"
                aria-label={
                  (item.completedAt ? "Reopen " : "Complete ") + item.text
                }
                onClick={() =>
                  void onChange(entry, {
                    listItems: entry.listItems.map((task) =>
                      task.id === item.id
                        ? {
                            ...task,
                            completedAt: task.completedAt
                              ? null
                              : new Date().toISOString(),
                          }
                        : task,
                    ),
                  })
                }
              >
                {item.completedAt ? <CheckCircle2 /> : <Circle />}
              </button>
              <span>{item.text}</span>
              <time>
                {item.dueAt
                  ? formatDateTime(item.dueAt, timeZone)
                      .split(",")
                      .slice(0, 2)
                      .join(",")
                  : "No date"}
              </time>
              <button
                className="icon-button"
                aria-label={"Create reminder for " + item.text}
                onClick={() => onRemind(item.text, item.dueAt)}
              >
                <Bell size={18} />
              </button>
            </div>
          ))}
          <p className="helper-text">
            Task dates organize your list. Use the bell to create a separate
            push reminder.
          </p>
        </div>
      )}
      {entry.reminderAt && (
        <p className="reminder-chip">
          {formatDateTime(entry.reminderAt, timeZone)} · {entry.reminderState}
          {entry.recurrenceRule ? " · " + entry.recurrenceRule : ""}
        </p>
      )}
      <div className="tag-row">
        {entry.tags.map((tag) => (
          <span className="tag" key={tag.id}>
            #{tag.name}
          </span>
        ))}
      </div>
      <div className="detail-files">
        {entry.attachments.map((file) => (
          <a href={file.url} key={file.id} target="_blank" rel="noreferrer">
            {file.mimeType.startsWith("image/") && file.url && (
              <img src={file.url} alt="" />
            )}
            {file.fileName}
          </a>
        ))}
      </div>
      <footer className="detail-footer">
        <small>Saved {formatDateTime(entry.updatedAt, timeZone)}</small>
        <button
          className="secondary-button"
          onClick={() =>
            void navigator.clipboard.writeText(
              [
                entry.title,
                entry.body,
                ...entry.listItems.map(
                  (item) => (item.completedAt ? "[x] " : "[ ] ") + item.text,
                ),
              ].join("\n"),
            )
          }
        >
          <Copy size={16} /> Copy
        </button>
        <button className="primary-button" onClick={onEdit}>
          <Pencil size={16} /> Edit
        </button>
      </footer>
    </Modal>
  );
}
export function SyncPanel({
  onRetry,
  onClose,
}: {
  onRetry: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void drainOutbox().then(setItems);
  }, []);
  return (
    <Modal label="Sync status" onClose={onClose} className="sync-panel">
      <h2>Saved on this device</h2>
      <p>
        These captures are retained here until the entry and every attachment
        reach your account.
      </p>
      {items.length ? (
        items.map((item) => (
          <article key={String(item.id)}>
            <strong>
              {String(
                (item.input as { title?: string })?.title || "Untitled capture",
              )}
            </strong>
            <p>{String(item.error || "Waiting to sync")}</p>
            <button
              className="text-button danger-text"
              onClick={async () => {
                if (
                  !confirm(
                    "Discard this queued capture and its local files? Any copy already saved to your account stays there.",
                  )
                )
                  return;
                await acknowledgeOutbox(String(item.id));
                setItems(items.filter((current) => current.id !== item.id));
                window.dispatchEvent(new Event("online"));
              }}
            >
              Discard local queued copy
            </button>
          </article>
        ))
      ) : (
        <p>No captures waiting to sync.</p>
      )}
      <div className="button-row">
        <a className="secondary-button" href="/api/v1/auth/github">
          Sign in again
        </a>
        <button
          className="primary-button"
          onClick={() => {
            onRetry();
            onClose();
          }}
        >
          Retry sync
        </button>
        <button className="secondary-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
export function AiWorkspace({
  notify,
  onSave,
}: {
  notify: (message: string) => void;
  onSave: (text: string, kind: "note" | "list") => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [includeFiles, setIncludeFiles] = useState(false),
    [consent, setConsent] = useState(false);
  const [action, setAction] =
      useState<Parameters<typeof runAi>[0]["action"]>("summarize"),
    [request, setRequest] = useState("");
  const [result, setResult] = useState(""),
    [busy, setBusy] = useState(false),
    [incomplete, setIncomplete] = useState(false);
  useEffect(() => {
    void Promise.all([getEntries(), getAiStatus()])
      .then(([items, state]) => {
        setEntries(items);
        setStatus(state);
      })
      .catch((error) => setError(error.message));
    void cachedValue<string>("ai-result").then((value) =>
      setResult(value || ""),
    );
  }, []);
  const data = entries
    .filter((entry) => selected.includes(entry.id))
    .map((entry) => aiEntry(entry, includeFiles));
  const preview = serializeAiEntries(data);
  useEffect(() => setConsent(false), [preview, request, action]);
  const run = async () => {
    if (!consent || !data.length || preview.length > AI_INPUT_LIMIT) return;
    setBusy(true);
    setError("");
    try {
      const response = await runAi({ action, request, entries: data });
      setResult(response.text);
      setIncomplete(Boolean(response.incomplete));
      await cacheValue("ai-result", response.text);
      setStatus(await getAiStatus());
      setConsent(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="utility-panel ai-workspace">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">YOUR KNOWLEDGE, YOUR CHOICE</span>
          <h1>AI workspace</h1>
          <p>
            Select the entries, review the exact data, then approve one request.
          </p>
        </div>
      </header>
      <div className="ai-status">
        <strong>
          {status?.model || "Checking model"} ·{" "}
          {status?.reasoningEffort || "high"}
        </strong>
        <p>
          {status?.configured
            ? "API key is configured on the server. This does not verify available credit or permissions."
            : "API key is not configured."}
        </p>
        <small>
          {status
            ? status.usedToday +
              "/" +
              status.dailyLimit +
              " requests today · " +
              status.usedThisMonth +
              "/" +
              status.monthlyLimit +
              " this month (UTC)"
            : "Loading usage…"}{" "}
          · API usage is billed by OpenAI. These are request limits, not a
          dollar spending cap.
        </small>
      </div>
      <div className="ai-workbench">
        <section className="ai-selection">
          <h2>1. Choose entries</h2>
          <input
            aria-label="Find entries for AI"
            placeholder="Find an entry…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <p>{selected.length} selected · maximum 40</p>
          <button className="text-button" onClick={() => setSelected([])}>
            Clear selection
          </button>
          <div className="selection-list">
            {entries
              .filter((entry) =>
                [entry.title, entry.body]
                  .join(" ")
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((entry) => (
                <label key={entry.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(entry.id)}
                    disabled={
                      !selected.includes(entry.id) && selected.length >= 40
                    }
                    onChange={() =>
                      setSelected((ids) =>
                        ids.includes(entry.id)
                          ? ids.filter((id) => id !== entry.id)
                          : [...ids, entry.id],
                      )
                    }
                  />
                  <span>
                    <strong>
                      {entry.title || entry.body.slice(0, 60) || "Untitled"}
                    </strong>
                    <small>
                      {entry.kind} ·{" "}
                      {entry.listItems.length
                        ? entry.listItems.length + " tasks"
                        : entry.body.slice(0, 90)}
                    </small>
                  </span>
                </label>
              ))}
          </div>
        </section>
        <section className="ai-request">
          <h2>2. Review and ask</h2>
          <label className="field">
            <span>Action</span>
            <select
              value={action}
              onChange={(event) =>
                setAction(event.target.value as typeof action)
              }
            >
              <option value="summarize">Summarize</option>
              <option value="ask">Answer a question</option>
              <option value="extract_actions">Extract actions</option>
              <option value="weekly_review">Weekly review</option>
              <option value="suggest_tags">Suggest tags</option>
              <option value="find_duplicates">Find duplicates</option>
            </select>
          </label>
          <label className="field">
            <span>Your instruction</span>
            <textarea
              maxLength={1000}
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="What would you like to know?"
            />
          </label>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={includeFiles}
              onChange={(event) => setIncludeFiles(event.target.checked)}
            />{" "}
            Include attachment filenames and extracted text (not original files)
          </label>
          <details className="data-preview">
            <summary>
              Exact entry data: {data.length} entries ·{" "}
              {preview.length.toLocaleString()} / 60,000 characters
            </summary>
            <pre>{preview}</pre>
          </details>
          <p className="helper-text">
            Titles, text, tags, source URLs, task completion and due dates are
            included. Nothing is silently truncated. Your instruction above is
            also sent. Requests use store: false; API abuse-monitoring retention
            can still apply.
          </p>
          {preview.length > AI_INPUT_LIMIT && (
            <p role="alert">
              Select fewer entries or omit attachment text to fit the input
              limit.
            </p>
          )}
          <label className="consent-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />{" "}
            I approve sending this selection and instruction to OpenAI for this
            request.
          </label>
          <button
            className="primary-button"
            disabled={
              busy ||
              !consent ||
              !status?.configured ||
              !data.length ||
              preview.length > AI_INPUT_LIMIT
            }
            onClick={() => void run()}
          >
            {busy ? "Working…" : "Run AI tool"}
          </button>
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
      {result && (
        <section className="ai-result">
          <h2>Result</h2>
          {incomplete && (
            <p role="alert">
              The output limit was reached. This answer may be incomplete. No
              automatic retry was made.
            </p>
          )}
          <p className="detail-body">{result}</p>
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(result)
                  .then(() => notify("Result copied."))
              }
            >
              Copy result
            </button>
            <button
              className="primary-button"
              onClick={() => onSave(result, "note")}
            >
              Save as note
            </button>
            <button
              className="secondary-button"
              onClick={() => onSave(result, "list")}
            >
              Review as a list
            </button>
          </div>
          <small>
            The most recent result is retained on this device until you save it
            to your account.
          </small>
        </section>
      )}
    </section>
  );
}
export function TodayWorkspace({
  entries,
  timeZone,
  renderEntry,
}: {
  entries: Entry[];
  timeZone: string;
  renderEntry: (entry: Entry) => ReactNode;
}) {
  const today = dateKey(new Date(), timeZone);
  const [section, setSection] = useState("all");
  const groups = [
    {
      id: "overdue",
      label: "Overdue",
      items: entries.filter((entry) =>
        entryDueDates(entry).some((date) => dateKey(date, timeZone) < today),
      ),
    },
    {
      id: "today",
      label: "Due today",
      items: entries.filter((entry) =>
        entryDueDates(entry).some((date) => dateKey(date, timeZone) === today),
      ),
    },
    {
      id: "upcoming",
      label: "Upcoming",
      items: entries.filter((entry) =>
        entryDueDates(entry).some((date) => dateKey(date, timeZone) > today),
      ),
    },
    {
      id: "captured",
      label: "Captured today",
      items: entries.filter(
        (entry) => dateKey(entry.createdAt, timeZone) === today,
      ),
    },
  ];
  return (
    <div className="today-workspace">
      <div className="today-summary">
        {groups.map((group) => (
          <button
            key={group.id}
            aria-pressed={section === group.id}
            onClick={() => setSection(section === group.id ? "all" : group.id)}
          >
            <strong>{group.items.length}</strong>
            <span>{group.label}</span>
            <small>entries</small>
          </button>
        ))}
      </div>
      {groups
        .filter((group) => section === "all" || section === group.id)
        .map((group) => (
          <section className="today-group" key={group.id}>
            <header>
              <h2>{group.label}</h2>
              <small>
                {group.items.length}{" "}
                {group.items.length === 1 ? "entry" : "entries"}
              </small>
            </header>
            {group.items.length ? (
              <div className="entry-grid">{group.items.map(renderEntry)}</div>
            ) : (
              <p className="helper-text">Nothing here. You’re up to date.</p>
            )}
          </section>
        ))}
    </div>
  );
}
export function NotificationSettings({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [state, setState] = useState("Checking this device…"),
    [registered, setRegistered] = useState(false),
    [devices, setDevices] = useState<
      Array<{
        id: string;
        device_label: string;
        last_success_at: string | null;
      }>
    >([]),
    [busy, setBusy] = useState(false);
  const check = async () => {
    if (
      !("Notification" in window) ||
      !("PushManager" in window) ||
      !("serviceWorker" in navigator)
    ) {
      setState("Push is not supported in this browser.");
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (isLocalMode) {
      setState("Local preview. Live push delivery is unavailable.");
      return;
    }
    const result = await remote<{
      registered: boolean;
      subscriptions: typeof devices;
    }>(
      "/push-subscriptions" +
        (subscription
          ? "?endpoint=" + encodeURIComponent(subscription.endpoint)
          : ""),
    );
    setRegistered(result.registered);
    setDevices(result.subscriptions);
    setState(
      Notification.permission === "denied"
        ? "Notifications are blocked in this browser’s site settings."
        : result.registered
          ? "This device is connected."
          : "This device is not connected.",
    );
  };
  useEffect(() => {
    void check().catch((error) => setState(error.message));
  }, []);
  const connect = async () => {
    setBusy(true);
    try {
      if (isLocalMode) {
        notify("Push setup is available in the live app.");
        return;
      }
      if ((await Notification.requestPermission()) !== "granted") {
        await check();
        return;
      }
      const key = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || "");
      if (!key) throw new Error("Push keys are not configured.");
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration)
        throw new Error("Reload once to finish installing the app.");
      const padded =
        key.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (key.length % 4)) % 4);
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(atob(padded), (char) =>
            char.charCodeAt(0),
          ),
        }));
      await subscribeToPush(subscription);
      await check();
      notify("This device is connected to push reminders.");
    } catch (error) {
      setState(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-card">
      <div className="settings-copy">
        <h3>Push reminders</h3>
        <p role="status">{state}</p>
        <p>
          Reminders use browser notifications with your reminder title and a
          short preview. Task due dates do not send push by themselves.
        </p>
        <div className="button-row">
          <button
            className="primary-button"
            disabled={busy || registered}
            onClick={() => void connect()}
          >
            {registered ? "Connected" : "Connect this device"}
          </button>
          <button
            className="secondary-button"
            disabled={!registered || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await createEntry({
                  id: crypto.randomUUID(),
                  kind: "reminder",
                  title: "Mind Boss push test",
                  body: "Your reminder delivery is working. You can complete or delete this test.",
                  reminderAt: new Date(Date.now() + 10_000).toISOString(),
                });
                notify(
                  "Test reminder scheduled. It should arrive on connected devices within about a minute, outside quiet hours.",
                );
              } catch (error) {
                notify((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Send test reminder
          </button>
          <button
            className="text-button"
            onClick={() =>
              void check().catch((error) => setState(error.message))
            }
          >
            Refresh status
          </button>
        </div>
        <p className="helper-text">
          The test sends to all connected devices. Push-service acceptance is
          not a guarantee that the operating system displayed it.
        </p>
        <div className="device-list">
          {devices.map((device) => (
            <div key={device.id}>
              <strong>{device.device_label}</strong>
              <small>
                {device.last_success_at
                  ? "Last push accepted: " +
                    new Date(device.last_success_at).toLocaleString()
                  : "No push accepted yet"}
              </small>
              <button
                className="text-button danger-text"
                onClick={async () => {
                  await remote("/push-subscriptions/" + device.id, {
                    method: "DELETE",
                    body: "{}",
                  });
                  await check();
                }}
              >
                Disconnect
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
export function RestorePanel({
  notify,
  onComplete,
}: {
  notify: (message: string) => void;
  onComplete: () => void;
}) {
  const [backup, setBackup] = useState<{
    entries: Entry[];
    tags?: unknown[];
    preferences?: unknown;
    templates?: unknown[];
    savedSearches?: unknown[];
  } | null>(null);
  const [files, setFiles] = useState<Record<string, Uint8Array>>({}),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [message, setMessage] = useState("");
  const choose = async (file?: File) => {
    if (!file) return;
    setMessage("");
    setBackup(null);
    setFiles({});
    try {
      if (file.size > 256 * 1024 * 1024)
        throw new Error(
          "This browser restore supports backups up to 256 MB. Split larger libraries into smaller backups.",
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text: string;
      if (file.name.toLowerCase().endsWith(".zip")) {
        let total = 0;
        const archive = unzipSync(bytes, {
          filter: (item) => {
            total += item.originalSize;
            if (
              total > 512 * 1024 * 1024 ||
              item.originalSize > 25 * 1024 * 1024
            )
              throw new Error("Archive exceeds safe restore limits.");
            return (
              item.name === "mindboss-backup.json" ||
              /^attachments\/[a-zA-Z0-9-]+\//.test(item.name)
            );
          },
        });
        if (!archive["mindboss-backup.json"])
          throw new Error("The ZIP does not contain mindboss-backup.json.");
        text = strFromU8(archive["mindboss-backup.json"]);
        setFiles(archive);
      } else text = strFromU8(bytes);
      const data = JSON.parse(text);
      if (
        !data ||
        !Array.isArray(data.entries) ||
        !data.entries.every(
          (entry: Entry) =>
            entry &&
            typeof entry.id === "string" &&
            ["note", "list", "reminder"].includes(entry.kind) &&
            Array.isArray(entry.listItems) &&
            Array.isArray(entry.attachments),
        )
      )
        throw new Error("This is not a valid Mind Boss backup.");
      setBackup(data);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const restore = async () => {
    if (!backup) return;
    setBusy(true);
    let created = 0,
      skipped = 0,
      uploaded = 0;
    try {
      for (
        let index = 0;
        index < Math.max(1, backup.entries.length);
        index += 25
      ) {
        const batch = backup.entries.slice(index, index + 25);
        let ids: string[];
        if (isLocalMode) {
          ids = [];
          for (const entry of batch) {
            const all = (
              await Promise.all(
                ["active", "archived", "trashed"].map((status) =>
                  getEntries({ status: status as Entry["status"] }),
                ),
              )
            ).flat();
            if (all.some((item) => item.id === entry.id)) {
              skipped++;
              continue;
            }
            const saved = await createEntry({ ...entry, tagIds: [] });
            await updateEntry(saved.id, {
              ...entry,
              version: saved.version,
              attachments: [],
            });
            created++;
            ids.push(entry.id);
          }
        } else {
          const result = await remote<{
            created: string[];
            skipped: string[];
            uploadIds: string[];
            errors: Array<{ id: string; message: string }>;
          }>("/import/backup", {
            method: "POST",
            body: JSON.stringify({
              entries: batch,
              tags: backup.tags || [],
              restoreSettings: settings && index === 0,
              preferences: backup.preferences,
              templates: backup.templates,
              savedSearches: backup.savedSearches,
            }),
          });
          created += result.created.length;
          skipped += result.skipped.length;
          ids = result.uploadIds;
          if (result.errors.length)
            throw new Error(
              result.errors.map((error) => error.message).join("; "),
            );
        }
        for (const entry of batch.filter((item) => ids.includes(item.id)))
          for (const attachment of entry.attachments) {
            const path = Object.keys(files).find((path) =>
              path.startsWith(
                "attachments/" + entry.id + "/" + attachment.id + "-",
              ),
            );
            if (!path) {
              if (files["mindboss-backup.json"])
                throw new Error(
                  "The ZIP is missing " +
                    attachment.fileName +
                    ". No attachment was substituted.",
                );
              continue;
            }
            await addAttachment(
              entry.id,
              new File([files[path].slice().buffer], attachment.fileName, {
                type: attachment.mimeType,
              }),
              attachment.extractedText || "",
            );
            uploaded++;
          }
        setMessage(
          "Processed " +
            Math.min(index + 25, backup.entries.length) +
            " of " +
            backup.entries.length +
            " entries…",
        );
      }
      const result =
        "Restore complete: " +
        created +
        " added, " +
        skipped +
        " existing entries preserved, " +
        uploaded +
        " attachment files processed.";
      setMessage(result);
      notify(result);
      onComplete();
    } catch (error) {
      setMessage(
        "Restore paused: " +
          (error as Error).message +
          " Your completed batches are saved. Retry the same backup to resume safely.",
      );
    } finally {
      setBusy(false);
    }
  };
  const fileCount =
    backup?.entries.reduce((n, entry) => n + entry.attachments.length, 0) || 0;
  return (
    <section className="settings-card">
      <div className="settings-copy">
        <h3>Restore a Mind Boss backup</h3>
        <p>
          Add missing entries from JSON or ZIP. Existing entries and permanently
          deleted IDs are not overwritten. Repeating a restore is safe.
        </p>
        <label className="secondary-button file-action">
          Choose JSON or ZIP
          <input
            type="file"
            accept=".json,.zip"
            disabled={busy}
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </label>
        {backup && (
          <div className="restore-preview">
            <p>
              {backup.entries.length} entries · {fileCount} attachment records ·{" "}
              {
                Object.keys(files).filter((path) =>
                  path.startsWith("attachments/"),
                ).length
              }{" "}
              files available
            </p>
            {fileCount > 0 && !Object.keys(files).length && (
              <p role="alert">
                JSON has attachment metadata only. Use the full ZIP backup to
                restore files.
              </p>
            )}
            <label className="consent-row">
              <input
                type="checkbox"
                checked={settings}
                onChange={(event) => setSettings(event.target.checked)}
              />{" "}
              Also restore preferences and add missing templates and saved
              searches
            </label>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void restore()}
            >
              {busy ? "Restoring…" : "Restore reviewed backup"}
            </button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
