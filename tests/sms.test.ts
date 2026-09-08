import { describe, expect, it } from "vitest";
import {
  smsReminder,
  validTwilioSignature,
} from "../functions/api/v1/[[path]]";

describe("SMS capture security and parsing", () => {
  it("validates Twilio's complete form signature", async () => {
    const token = "test_auth_token";
    const url = "https://mindboss.example/api/v1/sms/inbound";
    const form = new FormData();
    form.set("Body", "NOTE Keep this");
    form.set("From", "+16025550123");
    form.set("MessageSid", "SM123");
    const payload = `${url}BodyNOTE Keep thisFrom+16025550123MessageSidSM123`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(token),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const signed = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    );
    const signature = Buffer.from(signed).toString("base64");
    expect(await validTwilioSignature(token, signature, url, form)).toBe(true);
    expect(await validTwilioSignature(token, "invalid", url, form)).toBe(false);
  });

  it("parses explicit Arizona reminder commands", () => {
    const parsed = smsReminder("2026-09-10 09:30 | Call the office");
    expect(parsed.body).toBe("Call the office");
    expect(parsed.reminderAt).toBe("2026-09-10T16:30:00.000Z");
  });
});
