import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const worker = await readFile(
  new URL("../functions/api/features.ts", import.meta.url),
  "utf8",
);
const client = await readFile(
  new URL("../src/workflow-panels.tsx", import.meta.url),
  "utf8",
);

describe("secure AI integration", () => {
  it("uses only the server-side OpenAI secret", () => {
    expect(worker).toContain("env.OPENAI_API_KEY");
    expect(worker).not.toContain("body.apiKey");
    expect(client).not.toContain("mindboss.ai.key");
    expect(client).not.toContain("OpenAI API key</span>");
  });

  it("locks cost and privacy controls", () => {
    expect(worker).toContain('const AI_MODEL = "gpt-5.6-sol"');
    expect(worker).toContain('const AI_REASONING_EFFORT = "high"');
    expect(worker).toContain("reasoning: { effort: AI_REASONING_EFFORT }");
    expect(worker).toContain("const AI_DAILY_LIMIT = 5");
    expect(worker).toContain("const AI_MONTHLY_LIMIT = 50");
    expect(worker).toContain("store: false");
    expect(worker).toContain("max_output_tokens: 900");
  });
});
