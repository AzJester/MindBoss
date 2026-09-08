# Mind Boss

Mind Boss is a private, single-owner knowledge app for capturing notes, links, lists, reminders, and attachments. It is an original application inspired by the fast capture and retrieval loop of MindChuk. It does not copy MindChuk branding, code, or interface.

The app is designed for one authorized GitHub account, a Chrome clipper, and an installable Android PWA that appears in the Android Share menu.

## What is implemented

- Responsive React and TypeScript application with Today, inbox, lists, reminders, review, archive, trash, tags, and settings.
- Notes, ordered checklists with item due dates, natural-language and recurring reminders in `America/Phoenix`, quiet hours, pinning, copy, archive, restore, 30-day trash, and optimistic concurrency handling.
- Nested tags with whole-word, case-insensitive trigger rules. Manual tags are never removed by trigger recalculation.
- Inline tag creation, reusable capture templates, pasted-link recognition, advanced filters, query syntax, and saved searches.
- D1 FTS5 search over titles, bodies, source metadata, checklist items, PDF text, and image OCR text.
- Images and PDFs in private R2 storage, limited to five files and 20 MB per file, with client-side image compression, previews, text extraction, server-side signature detection, and content-deduplicated retry.
- GitHub OAuth with PKCE, one-use state, exact immutable-account allowlisting, hashed opaque sessions, rotating cookies, CSRF, and origin validation.
- Web Push subscriptions encrypted at rest and a scheduled reminder Worker.
- Offline draft saving, Android share intake through IndexedDB, Background Sync, visible sync state, and automatic refresh across devices.
- Manifest V3 Chrome clipper with toolbar, context menu, keyboard shortcut, selected-text capture, capture-only tokens, and an offline retry queue.
- Browser-side MindChuk CSV parsing and mapping, resumable 100-record imports, repeat-import deduplication, CSV and JSON export, and full ZIP backup with attachment files.
- Review-date resurfacing, stale-note and on-this-day review queues, and an onboarding checklist.
- Optional bring-your-own-key OpenAI tools with an explicit per-request data preview. Keys stay in browser session storage and requests use `store: false`.
- Optional Twilio SMS capture with an exact sender allowlist, signed webhook validation, message retry deduplication, built-in commands, hashtags, and tag trigger keywords.

## Architecture

```text
Android Share / PWA / Chrome clipper
                 |
       Cloudflare Pages + Functions
                 |
           D1 + private R2
                 |
     Scheduled reminder Worker
                 |
             Web Push
```

## Local development

Requirements: Node.js 22+, npm, and a Chromium browser for end-to-end tests.

```bash
npm ci
cp .env.example .dev.vars
npm run db:migrate:local
npm run pages:dev
```

For interface-only development, `npm run dev` uses an isolated local demo library in browser storage and does not require Cloudflare bindings.

Run the complete verification suite:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run extension:package
npm audit --audit-level=moderate
```

## Deployment

The production target is `https://mindboss.st-dba.com`. Account provisioning, secrets, custom-domain setup, GitHub OAuth registration, and the GoDaddy CNAME are intentionally not committed. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the exact one-time setup and release procedure.

The stable unpacked extension ID is `leaohbibobpmkglcmgkopckkkhabbfkd`. Changing the public key in `extension/manifest.json` changes the ID and breaks the configured origin allowlist.

## Security position

Mind Boss is a personal notes system, not a password manager. Production note data, attachments, OAuth credentials, cookie secrets, encryption keys, VAPID keys, and clipper tokens must never be added to Git. See [SECURITY.md](SECURITY.md) for the supported threat boundary and reporting guidance.

## License

No license is granted. This repository is source-visible for its owner's use.
