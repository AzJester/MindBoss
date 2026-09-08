# Mind Boss 0.3.0: reliability and interface

## What changed

- Cleaner graphite and light surfaces, readable type, labeled mobile navigation, and keyboard-friendly detail and date dialogs.
- Full-size Due buttons, explicit list Due labels, all-task expansion, and read-first entry details.
- Today sections for overdue, due today, upcoming, and captured entries; weekly review uses the configured day.
- Feed, Board, Calendar, and Grid; Calendar expands busy days and defaults to an agenda on phones.
- Settings grouped into Account, Appearance, Notifications, Capture, and Data with complete-library storage totals.
- Search correctly combines typed tag/type filters, rejects unknown-tag matches, and uses inclusive local date ranges.
- Durable drafts and shared files, offline shell caching, cached account access without fabricated authentication, and visible pending-capture inspection/retry.
- Chrome clipper retains failed/revoked-token captures, serializes its queue, retries on reconnect and alarms, and acknowledges only successful uploads.
- Complete JSON/CSV exports, structured CSV round trips, safe additive JSON/ZIP restore, nested tags, and resumable attachment uploads.
- Atomic entry updates reject stale edits; deletion tombstones stop delayed offline recreation; failed file cleanup remains queued.
- Reminder recurrence uses the selected timezone, handles local weekdays and month-end anchors, and advances past missed intervals.
- Per-device push acknowledgments retry failed devices without resending to devices already accepted by the push service.
- AI selection starts empty, previews all selected task/source data, resets consent on changes, warns about incomplete responses, and supports copy/save result actions.

## Validation

The automated suite includes real Cloudflare D1 migrations and Pages handlers, an R2-compatible failure binding, full export/import round trips, stale edits, cleanup retries, partial push delivery, extension queue execution, and browser tests at 1440, 768, 390, and 320 pixels. PWA browser tests install the service worker, reload offline, and verify shared files survive navigation and refresh.

Browser tests use isolated demo data or an intercepted local D1-backed API. They do not write to the production library, call paid AI, or send real push messages.

The deployment workflow records a D1 recovery bookmark before migration, deploys the exact commit that passed CI, then publishes Pages and the scheduled Worker.

## Scope and honest limits

- No new paid infrastructure or SMS service is enabled. Existing OpenAI requests remain optional and separately billed.
- The configured model remains GPT-5.6 Sol with high reasoning. Existing 5/day, 50/month request limits and 900 output-token setting are retained. They are not a dollar spending cap. If the model exhausts its output budget, the app reports it and does not automatically retry.
- Push-service acceptance is not proof that an operating system displayed the notification. Device permissions, quiet hours, OS restrictions, network availability, and battery settings can delay or suppress it.
- Real Android installation, OS Share menu invocation, and a notification with the app closed still require an actual Android device check.
- JSON exports contain attachment metadata. ZIP backups contain files. Browser restore accepts up to 256 MB compressed, 512 MB expanded, and 25 MB per ZIP member. Existing entries and permanently deleted IDs are never overwritten by restore.
- Keep the extension's stable public key. Update the existing unpacked extension to 0.3.0 and reload it in Chrome; existing token storage and queued clips use the same extension ID.
- Reload Mind Boss to pick up the release. Updating the service worker never forcibly reloads an open draft.
