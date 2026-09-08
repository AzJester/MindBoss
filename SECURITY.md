# Security

## Supported use

Mind Boss is a private, single-owner notes application. It is not designed to store passwords, private keys, payment-card data, authentication recovery codes, or regulated records.

## Production controls

- Authentication is accepted only for immutable GitHub user ID `127560421`.
- The GitHub access token exists only during identity verification and is not persisted.
- Session and clipper tokens are stored as hashes. Session cookies are `Secure`, `HttpOnly`, and `SameSite=Lax`.
- Session identifiers and CSRF tokens rotate on application load.
- Browser mutations require the exact production origin and a session CSRF token.
- Extension tokens can create clips only. They cannot read, edit, search, export, or delete entries.
- Push endpoints and Web Push key material are AES-GCM encrypted before D1 storage.
- Attachments are private R2 objects. Downloads require an authenticated session and server-side ownership check.
- Uploaded files are checked by signature. Browser MIME declarations are not trusted.
- The API never fetches a clipped URL.
- Application logs contain request IDs, stable error codes, counts, and delivery results. They do not contain note text, URLs, filenames, OAuth values, push endpoints, or attachment data.

## Secrets

Keep these values only in Cloudflare secrets or GitHub Actions secrets:

- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`
- `PUSH_ENCRYPTION_KEY`
- `VAPID_PRIVATE_KEY`
- `CLOUDFLARE_API_TOKEN`

Treat a clipper token like a password. Revoke and replace it from Mind Boss settings if it is exposed.

## Reporting

Do not open a public issue containing a vulnerability, secret, note, URL, or attachment. Contact the repository owner privately with the affected route, reproducible steps, and impact.
