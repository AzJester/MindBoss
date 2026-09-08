import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const runtimes: Miniflare[] = [];
export async function disposeTestDatabases() {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
}
import { readFileSync, readdirSync } from "node:fs";
import { sha256, type Env } from "../../functions/api/_lib";
import { onRequest } from "../../functions/api/v1/[[path]]";
export async function testDatabase(origin = "https://mindboss.test") {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "test",
          modules: true,
          script: "export default {fetch(){return new Response('test')}}",
          d1Databases: ["DB"],
          r2Buckets: ["ATTACHMENTS"],
          compatibilityDate: "2026-09-01",
        },
      ],
    }),
  );
  runtimes.push(runtime);
  const binding = await runtime.getD1Database("DB");
  const folder = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(folder)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    const statements = readFileSync(new URL(file, folder), "utf8")
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean);
    await binding.batch(statements.map((sql) => binding.prepare(sql)));
  }
  const db = {
    prepare: (sql: string) => ({
      run: (...values: unknown[]) =>
        binding
          .prepare(sql)
          .bind(...values)
          .run(),
      get: (...values: unknown[]) =>
        binding
          .prepare(sql)
          .bind(...values)
          .first(),
      all: async (...values: unknown[]) =>
        (
          await binding
            .prepare(sql)
            .bind(...values)
            .all()
        ).results,
    }),
  };
  const objects = new Map<string, ArrayBuffer>();
  let failDelete = false;
  const bucket = {
    put: async (key: string, value: ArrayBuffer) => {
      objects.set(key, value);
      return {};
    },
    get: async (key: string) => {
      const data = objects.get(key);
      return data ? { body: new Blob([data]).stream() } : null;
    },
    delete: async (key: string | string[]) => {
      if (failDelete) throw new Error("Temporary R2 outage");
      for (const path of Array.isArray(key) ? key : [key]) objects.delete(path);
    },
  };
  const env = {
    DB: binding,
    ATTACHMENTS: bucket,
    APP_ORIGIN: origin,
    ALLOWED_GITHUB_USER_ID: "127560421",
    SESSION_SECRET: "test-secret",
    PUSH_ENCRYPTION_KEY: "test-encryption-secret-of-at-least-32-characters",
    GITHUB_CLIENT_ID: "test",
    GITHUB_CLIENT_SECRET: "test",
  } as unknown as Env;
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO users(id,login,created_at,updated_at) VALUES(?,?,?,?)",
    )
    .run(127560421, "AzJester", now, now);
  const hash = await sha256("test-token:test-secret");
  await db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)")
    .run(
      hash,
      127560421,
      "test-csrf",
      now,
      new Date(Date.now() + 86400000).toISOString(),
      now,
    );
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ) => {
    const form = body instanceof FormData;
    return onRequest({
      env,
      request: new Request(env.APP_ORIGIN + "/api/v1" + path, {
        method,
        headers: {
          cookie: "mindboss_session=test-token",
          origin: env.APP_ORIGIN,
          "x-csrf-token": "test-csrf",
          ...(!form ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body:
          body === undefined ? undefined : form ? body : JSON.stringify(body),
      }),
    } as never) as Promise<Response>;
  };
  return {
    db,
    env,
    objects,
    call,
    setDeleteFailure: (value: boolean) => {
      failDelete = value;
    },
  };
}
