# Production deployment

This runbook provisions `https://mindboss.st-dba.com` without moving the `st-dba.com` nameservers away from GoDaddy.

## 1. Cloudflare resources

Authenticate Wrangler and create isolated resources:

```bash
npx wrangler login
npx wrangler d1 create mindboss-production
npx wrangler d1 create mindboss-preview
npx wrangler r2 bucket create mindboss-production-attachments
npx wrangler r2 bucket create mindboss-preview-attachments
```

Replace the D1 placeholder IDs in `wrangler.toml` and `wrangler.reminders.toml`. Create a Cloudflare Pages project named `mindboss`, then configure its production and preview bindings separately:

| Environment | `DB`                  | `ATTACHMENTS`                     | `APP_ORIGIN`                  |
| ----------- | --------------------- | --------------------------------- | ----------------------------- |
| Production  | `mindboss-production` | `mindboss-production-attachments` | `https://mindboss.st-dba.com` |
| Preview     | `mindboss-preview`    | `mindboss-preview-attachments`    | the chosen preview origin     |

Set these non-secret variables in production:

- `ALLOWED_GITHUB_USER_ID=127560421`
- `EXTENSION_ORIGIN=chrome-extension://leaohbibobpmkglcmgkopckkkhabbfkd`
- `VAPID_PUBLIC_KEY=<public key>`

Generate secrets locally. Use at least 32 random bytes for the session and push-encryption secrets.

```bash
npx web-push generate-vapid-keys
npx wrangler pages secret put GITHUB_CLIENT_ID --project-name mindboss
npx wrangler pages secret put GITHUB_CLIENT_SECRET --project-name mindboss
npx wrangler pages secret put SESSION_SECRET --project-name mindboss
npx wrangler pages secret put PUSH_ENCRYPTION_KEY --project-name mindboss
npx wrangler secret put VAPID_PRIVATE_KEY --config wrangler.reminders.toml
npx wrangler secret put VAPID_PUBLIC_KEY --config wrangler.reminders.toml
npx wrangler secret put VAPID_SUBJECT --config wrangler.reminders.toml
npx wrangler secret put PUSH_ENCRYPTION_KEY --config wrangler.reminders.toml
```

Use the same `PUSH_ENCRYPTION_KEY` for Pages and the reminder Worker. Do not reuse the session secret.

### Secure OpenAI connection

Store the OpenAI API key only as a Cloudflare Pages secret. Never put it in
GitHub, `wrangler.toml`, browser storage, or a build artifact.

```bash
npx wrangler pages secret put OPENAI_API_KEY --project-name mindboss
```

Mind Boss locks the integration to `gpt-5.4-mini`, sends only the preview the
owner explicitly approves, sets `store: false`, and enforces 10 requests per
UTC day and 200 requests per UTC month.

### Optional SMS capture

Buy or assign one SMS-capable Twilio number, then add the following Pages secrets:

```bash
npx wrangler pages secret put TWILIO_AUTH_TOKEN --project-name mindboss
npx wrangler pages secret put SMS_ALLOWED_FROM --project-name mindboss
npx wrangler pages secret put SMS_PHONE_NUMBER --project-name mindboss
```

`SMS_ALLOWED_FROM` must be the owner's mobile number in E.164 format, such as `+16025550123`. In Twilio, set the number's incoming-message webhook to:

```text
https://mindboss.st-dba.com/api/v1/sms/inbound
```

Use HTTP `POST`. Mind Boss validates `X-Twilio-Signature`, accepts only the exact allowed sender, and stores only a sender hash in its SMS audit record. It returns an empty TwiML response for normal captures so it does not send a paid confirmation message. `HELP` intentionally sends one reply.

Supported commands:

- `NOTE text` or ordinary text creates a note.
- `IDEA text` creates a note titled Idea.
- `LIST first item; second item` creates an ordered list.
- `REMIND tomorrow 9am | text` or `REMIND 2026-09-10 09:30 | text` creates a reminder in Arizona time.
- `#TAG` applies an existing tag. An existing tag name or trigger word can also be the first SMS keyword.
- `HELP` returns a short command reference.

SMS is optional and is the only workflow in Mind Boss that introduces a provider phone-number charge and per-message charges.

## 2. GitHub OAuth

Create one GitHub OAuth App with:

- Homepage URL: `https://mindboss.st-dba.com`
- Authorization callback URL: `https://mindboss.st-dba.com/api/v1/auth/github/callback`

Copy the client ID and new client secret into the Cloudflare Pages secrets. Mind Boss requests identity only and deletes the GitHub access token after calling the authenticated-user endpoint.

## 3. Database and first release

Before every production migration, record a D1 Time Travel bookmark:

```bash
npx wrangler d1 time-travel info mindboss-production --timestamp 2026-09-08T00:00:00Z --json
npx wrangler d1 migrations apply mindboss-production --remote --config wrangler.reminders.toml
```

Use the actual current UTC timestamp. Save the returned bookmark with the release evidence.

Deploy Pages and the reminder Worker:

```bash
npm ci
npm run build
npx wrangler pages deploy dist --project-name mindboss --branch main
npx wrangler deploy --config wrangler.reminders.toml
```

Set `VITE_VAPID_PUBLIC_KEY` during the Vite production build. In GitHub, add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `VITE_VAPID_PUBLIC_KEY` secrets. Set the repository variable `CLOUDFLARE_DEPLOY_ENABLED=true` only after resource IDs, bindings, and secrets are ready.

## 4. Custom domain and GoDaddy DNS

In the Cloudflare Pages project, add the custom domain `mindboss.st-dba.com`. Cloudflare will provide the Pages target hostname, usually `mindboss.pages.dev`.

At GoDaddy, create one DNS record:

| Type  | Name       | Value                                            |
| ----- | ---------- | ------------------------------------------------ |
| CNAME | `mindboss` | the Pages target hostname supplied by Cloudflare |

Do not change nameservers. Wait for Cloudflare to show the custom domain as active before validating OAuth.

## 5. Android installation and share target

1. Open `https://mindboss.st-dba.com` in Chrome on Android and sign in.
2. Choose **Install app** from the Chrome menu.
3. Share a link, selected text, image, and PDF from separate Android apps to **Mind Boss**.
4. For each share, verify that the preview opens before save and that an expired session does not discard the pending share.
5. Disable connectivity, share an item, save it, restore connectivity, and verify deferred synchronization.
6. Enable notifications and verify a real reminder arrives no more than 60 seconds after its due time.

## 6. Chrome clipper

1. Run `npm run extension:package`.
2. Unzip the versioned `artifacts/mindboss-clipper-*.zip` file to a stable local folder.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select that folder.
4. In Mind Boss settings, generate a clipper token and paste it into the extension once.
5. Verify toolbar, context-menu, `Ctrl+Shift+M`, selected-text, offline queue, and revoked-token behavior.

## 7. Release acceptance

Do not call the release complete until all of these checks pass:

- GitHub Actions CI and production jobs are green.
- `GET https://mindboss.st-dba.com/api/v1/health` returns `ok: true`.
- The custom domain certificate is valid and the OAuth callback completes.
- An unauthorized GitHub account is rejected.
- A note, list, recurring reminder, nested tag, trigger, saved search, attachment OCR, Today view, Review queue, board, calendar, flex layout, appearance preferences, archive, trash restore, import, CSV export, JSON export, and full ZIP backup work in production.
- Android installation, link/text/image/PDF sharing, offline retry, and Web Push work on a real phone.
- The unpacked extension clips a normal page and clearly rejects `chrome://` and Chrome Web Store pages.
- If SMS is enabled, a signed message from the allowed phone number is captured, an unapproved sender is rejected, and a repeated Twilio `MessageSid` creates no duplicate.
