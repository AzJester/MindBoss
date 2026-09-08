# Mind Boss

Mind Boss is a private, single-owner knowledge app for capturing notes, links, lists, reminders, and attachments. It is an original application inspired by the fast capture and retrieval loop of MindChuk. It does not copy MindChuk branding, code, or interface.

The app is designed for one authorized GitHub account, a Chrome clipper, and an installable Android PWA that appears in the Android Share menu.

## What is implemented

- Responsive React and TypeScript application with Today, inbox, lists, reminders, review, archive, trash, tags, and settings.
- Feed, time-grouped, configurable tag board, monthly calendar and mobile agenda, and dense Grid views with synchronized compact, sort, and tag-navigation preferences. Calendar days expand to show every scheduled item.
- Synchronized dark, light, and device-matched themes, three dashboard font styles, and a selectable display time zone that controls calendars, reminder parsing, snoozing, and quiet hours.
- Notes, ordered checklists with item due dates, natural-language and recurring reminders, quiet hours, pinning, copy, archive, restore, 30-day recoverable trash, optional immediate permanent deletion, and optimistic concurrency handling.
- Nested tags with whole-word, case-insensitive trigger rules. Manual tags are never removed by trigger recalculation.
- Inline tag creation, reusable capture templates, pasted-link recognition, advanced filters, query syntax, and saved searches.
- D1 FTS5 search over titles, bodies, source metadata, checklist items, PDF text, and image OCR text.
- Images and PDFs in private R2 storage, limited to five files and 20 MB per file, with client-side image compression, previews, text extraction, server-side signature detection, and content-deduplicated retry.
- GitHub OAuth with PKCE, one-use state, exact immutable-account allowlisting, hashed opaque sessions, rotating cookies, CSRF, and origin validation.
- Web Push subscriptions encrypted at rest and a scheduled reminder Worker.
- Durable offline drafts including files, Android share intake through IndexedDB, Background Sync with shared locking, an inspectable retry queue, cached offline access, and truthful device-versus-account save status.
- Manifest V3 Chrome clipper with toolbar, context menu, keyboard shortcut, selected-text capture, capture-only tokens, and an offline retry queue.
- Browser-side MindChuk CSV parsing and mapping, resumable 25-record batches, repeat-import deduplication, complete CSV and JSON exports without a 250-entry cap, full ZIP backups with attachment files, and additive JSON/ZIP restore.
- Review-date resurfacing, stale-note and on-this-day review queues, weekly-review prompts, and device-specific installation and notification guidance.
- Optional OpenAI tools using the existing server-side secret, GPT-5.6 Sol with high reasoning, explicit entry selection and a complete per-request preview. Consent resets when the data changes. Results can be copied or saved as notes/lists. Requests use `store: false`; configured does not imply that a paid API request has been verified. No API key is stored in browser storage.
- Legacy optional SMS code remains disabled and is not part of setup. No paid SMS service is provisioned or activated.

## Reliability and interface release (0.3.0)

Settings is organized into Account, Appearance, Notifications, Capture, and Data. Entries open in a read-first detail sheet. List rows have a Due column and a full-button calendar picker. Today separates overdue, due today, upcoming, and captured items. Sync, push registration, and AI setup states describe what has actually been confirmed.

The release adds atomic stale-write protection, per-device push retry tracking, timezone-safe recurrence with month-end anchors, durable R2 cleanup jobs, and deletion tombstones that prevent old offline captures from returning after permanent deletion. See [docs/RELEASE-0.3.0.md](docs/RELEASE-0.3.0.md) for validation and remaining device checks.

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
