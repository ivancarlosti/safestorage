# Configuration

SafeStorage is configured in two places:

1. **Environment variables** — read at process start; good for deployment-level values (port, accounts, authentication method, timezone).
2. **Admin settings** — stored in the database and edited from **Admin → Settings** in the web UI (`GET`/`POST /api/admin/service/settings`). These survive restarts and upgrades.

## Environment variables

| Variable                  | Used by              | Default                 | Description                                                                             |
| ------------------------- | -------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `PORT`                    | backend              | `8000`                  | Port the Fastify API listens on.                                                        |
| `HOST`                    | backend              | `localhost`             | Interface the API binds to. The container sets `0.0.0.0`.                               |
| `DATABASE_URL`            | backend / container  | _(none — required)_     | MariaDB/MySQL connection string, e.g. `mysql://user:password@host:3306/safestorage`.     |
| `SHADOW_DATABASE_URL`     | Prisma CLI (dev)     | _(none)_                | Optional throwaway database for `prisma migrate dev`. Never used by `migrate deploy`.    |
| `TZ`                      | backend / container  | `UTC`                   | Timezone used for log timestamps.                                                       |
| `SKIP_MIGRATIONS`         | container entrypoint | _(unset)_               | If set to any non-empty value, the entrypoint skips `prisma migrate deploy` on start.   |
| `DB_WAIT_ATTEMPTS`        | container entrypoint | `60`                    | How many times (every 2 s) the entrypoint retries the migrations while the database boots. |
| `SAFESTORAGE_VERSION`     | backend / frontend   | `dev`                   | Release version stamp, shown in `/api/version`, the admin panel and the startup banner. |
| `SAFESTORAGE_COMMIT`      | backend              | `unknown`               | Git commit stamp of the running build.                                                  |
| `BASE_API_URL`            | frontend (dev)       | `http://localhost:8000` | Target of the development `/api` rewrite. Not used in production.                       |
| `NODE_ENV`                | both                 | —                       | `production` in the Docker image, which also disables the frontend rewrite.             |
| `NEXT_TELEMETRY_DISABLED` | frontend             | `1` in the image        | Disables Next.js telemetry.                                                             |
| `AUTH_METHOD`             | backend              | `account`               | How users sign in: `account` (email + password form) or `keycloak` (OIDC single sign-on). |
| `ACCOUNT_LOGIN`           | backend              | _(none)_                | Comma-separated emails that may use the password form; the **first** one becomes the `owner`. |
| `ACCOUNT_PASSWORD`        | backend              | _(none)_                | Comma-separated passwords matched to `ACCOUNT_LOGIN` (a bcrypt hash is accepted).       |
| `KEYCLOAK_BASE_URL` … `KEYCLOAK_RESTRICT` | backend  | _(none)_                | OIDC provider settings, required by `AUTH_METHOD=keycloak` — see [Authentication](#authentication). |
| `RECAPTCHA_CLIENTID`      | backend / frontend   | _(none)_                | reCAPTCHA v2 site key; with the secret below, the login form shows the checkbox.        |
| `RECAPTCHA_CLIENTSECRET`  | backend              | _(none)_                | reCAPTCHA v2 secret, verified by the backend against `siteverify`.                      |

> **A note on migrations:** the container runs `prisma migrate deploy` automatically on every start (unless `SKIP_MIGRATIONS` is set), retrying while the database is still booting. You normally never need to run migrations by hand; set `SKIP_MIGRATIONS` only if you apply the SQL yourself. If the target database does not exist yet, `migrate deploy` creates it as long as the user in `DATABASE_URL` is allowed to.

The Docker Compose stacks read a `.env` file — see [`docker/.env.example`](../docker/.env.example) for the deployment-flavoured view of `DATABASE_URL`, `SAFESTORAGE_PORT`, `SAFESTORAGE_TAG`, `ACCOUNT_LOGIN`, `ACCOUNT_PASSWORD`, `TZ` and the authentication variables below.

## Authentication

SafeStorage signs users in with **one** method at a time, chosen by `AUTH_METHOD`. Both methods use the **email address** as the identity: it is what the unique `username` column holds and what every login is matched on.

| `AUTH_METHOD`       | Login screen                         | Registration                                | Change password |
| ------------------- | ------------------------------------ | ------------------------------------------- | --------------- |
| `account` (default) | email + password form                | allowed (still subject to the invite rules) | allowed         |
| `keycloak`          | "Sign in with single sign-on" button  | refused (`403`)                             | refused (`403`) |

Any other value falls back to `account`, with a warning in the logs. The method is read from the environment only — it decides which routes exist, so it cannot be flipped from the admin UI (the UI reads it back through `GET /api/settings` as `authMethod`).

On a `keycloak` instance the registration and change-password endpoints refuse the call **before** any other check, so a valid invite code does not get around it either: the account is created just in time on the first sign-in, and the password never lives here. The API-key endpoint stays available, so single sign-on users can still generate keys for the API.

### Local accounts (`AUTH_METHOD=account`)

| Variable           | Default  | Description                                                                                                                                |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACCOUNT_LOGIN`    | _(none)_ | Comma-separated emails. Each one gets an account on the first boot; the **first** receives the `owner` role, the others `user`.             |
| `ACCOUNT_PASSWORD` | _(none)_ | Comma-separated passwords, matched to `ACCOUNT_LOGIN` positionally. A **bcrypt hash** (`$2a$…`) is accepted as-is, so no plaintext is needed. |

There is **no default account**: an instance that declares no `ACCOUNT_LOGIN` starts with no users at all (the logs warn about it) and cannot be signed into until one is declared and the container restarted. An existing database is never modified — deployments created with the removed `ADMIN_PASSWORD` variable keep their `admin` row, which can then be deleted or renamed from **Admin → Users**.

An entry without a matching password gets a random one and cannot use the login form; the password can then be set by an admin from **Admin → Users** or by the owner from the **Credentials** page (`/dashboard/account`). After that, the `ACCOUNT_PASSWORD` value keeps working as a recovery credential.

### Keycloak / OIDC (`AUTH_METHOD=keycloak`)

| Variable                  | Default  | Description                                                                                          |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `KEYCLOAK_BASE_URL`       | _(none)_ | Realm root, e.g. `https://sso.example.com` — **without** `/realms/…`.                                |
| `KEYCLOAK_REALM`          | _(none)_ | Realm name.                                                                                          |
| `KEYCLOAK_CLIENT_ID`      | _(none)_ | Client id, used for the code exchange and the `aud`/`azp` check.                                     |
| `KEYCLOAK_CLIENT_SECRET`  | _(none)_ | Client secret. Omit it for a public client that relies on PKCE alone.                                |
| `KEYCLOAK_REDIRECT_URI`   | _(none)_ | Public URL of the callback: `https://<your-domain>/api/auth/keycloak/callback`. Register the same value as a _Valid redirect URI_ in the client. |
| `KEYCLOAK_RESTRICT`       | _(none)_ | Email allow-list: whole emails (`someone@example.com`) or bare domains (`example.com`).              |

The flow runs entirely on the backend (`GET /api/auth/keycloak/login` → the provider → `GET /api/auth/keycloak/callback`), so nginx's existing `/api/` proxy carries it and no CORS or cookie setting has to change. The callback verifies the `id_token` signature against the realm JWKS, checks `iss`, `aud`, `exp` and the `nonce`, refuses unverified email addresses, and then signs the matching account in — or creates it just in time, with the first one becoming the `owner`. Every failure redirects the browser to `/login?error=<code>`, which the login page turns into a message.

> **Single instance only:** the `state`/PKCE material of a pending login lives in the process memory, so several replicas would need sticky sessions or shared storage. The shipped container is a single instance.

Signing out only deletes SafeStorage's own `token` cookie; it does **not** end the session at the provider, so the next sign-in may complete without asking for credentials again. Configure the realm's SSO session idle timeout if that matters.

### reCAPTCHA on the login form

| Variable                 | Default  | Description                                                                       |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| `RECAPTCHA_CLIENTID`     | _(none)_ | reCAPTCHA **v2** site key, rendered by the login form.                             |
| `RECAPTCHA_CLIENTSECRET` | _(none)_ | reCAPTCHA **v2** secret, sent by the backend to `siteverify`.                      |

Both are required for the widget to appear: the site key is exposed as `recaptchaSiteKey` in `GET /api/settings`, and the form only renders the checkbox and demands a token when it is present — the backend rejects a login whose token is missing or invalid. Only the login form is protected, not the registration form.

## Admin settings

All of the following live in **Admin → Settings**. Values are grouped by category (as shown in the UI).

### Service

| Setting                 | Type    | Default           | Description                                                                                         |
| ----------------------- | ------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `serviceName`           | string  | `change-me`       | The name of your instance, shown throughout the UI.                                                 |
| `serveUploadsFrom`      | string  | _(empty)_         | Full domain (incl. `https://`) that directly serves uploaded files, e.g. `https://cdn.example.com`. |
| `rateLimitWindow`       | number  | `1000`            | Rate-limit window in ms. **Requires a restart.**                                                    |
| `rateLimitMax`          | number  | `100`             | Max requests per window. **Requires a restart.**                                                    |
| `secret`                | string  | random (64 chars) | JWT signing secret. Changing it logs everyone out.                                                  |
| `disableStatisticsCron` | boolean | `false`           | Disable the nightly statistics collection job.                                                      |
| `disableUpdateCheck`    | boolean | `false`           | Disable the daily update check against GitHub releases.                                             |

_(`port`, `host`, `statisticsCron`, `updateCheckCron` and `enabledStatistics` are read-only/derived and not editable in the UI.)_

### Uploads

| Setting                                  | Type    | Default                                       | Description                                                                       |
| ---------------------------------------- | ------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| `maxSize`                                | number  | `1000000000` (1 GB)                           | Maximum size of a single upload, in bytes.                                        |
| `chunkSize`                              | number  | `81000000` (~81 MB)                           | Size of each chunk for chunked (large) uploads, in bytes.                         |
| `chunkedUploadsTimeout`                  | number  | `1800000` (30 min)                            | How long an unfinished chunked upload is kept before it is discarded.             |
| `generateThumbnails`                     | boolean | `true`                                        | Generate thumbnails for images and videos (video needs `ffmpeg`).                 |
| `generateOriginalFileNameWithIdentifier` | boolean | `false`                                       | Append the identifier to the original filename instead of a random name.          |
| `enableMixedCaseFilenames`               | boolean | `true`                                        | Allow mixed-case filenames.                                                       |
| `generatedFilenameLength`                | number  | `12`                                          | Length of randomly generated filenames (≥ 8 recommended).                         |
| `blockedExtensions`                      | string  | `.jar,.exe,.msi,.com,.bat,.cmd,.scr,.ps1,.sh` | Comma-separated list of blocked upload extensions.                                |
| `blockNoExtension`                       | boolean | `true`                                        | Block files without an extension.                                                 |
| `saveDuplicatesToAlbum`                  | boolean | `false`                                       | When a duplicate is uploaded into an album, add the existing file to it.          |
| `useNetworkStorage`                      | boolean | `false`                                       | Upload to S3-compatible storage instead of local disk. See [Storage](storage.md). |
| `S3Region`                               | string  | _(empty)_                                     | Region of the S3 bucket.                                                          |
| `S3Bucket`                               | string  | _(empty)_                                     | Bucket name.                                                                      |
| `S3AccessKey`                            | string  | _(empty)_                                     | Bucket access key.                                                                |
| `S3SecretKey`                            | string  | _(empty)_                                     | Bucket secret key.                                                                |
| `S3PathStyle`                            | boolean | `false`                                       | Use path-style requests (usually `true` for non-AWS providers).                   |
| `S3Endpoint`                             | string  | _(empty)_                                     | Custom endpoint; leave empty for AWS S3.                                          |
| `S3PublicUrl`                            | string  | _(empty)_                                     | Public base URL of the bucket (needed for AWS S3).                                |

### Users

| Setting             | Type    | Default | Description                                                                       |
| ------------------- | ------- | ------- | --------------------------------------------------------------------------------- |
| `publicMode`        | boolean | `false` | Allow uploads without being logged in.                                            |
| `userAccounts`      | boolean | `false` | When disabled, no one can register without an invite.                             |
| `usersStorageQuota` | number  | `0`     | Default storage quota per user, in bytes (`0` = unlimited). Overridable per user. |

### Customization

| Setting              | Type    | Default                                   | Description                                |
| -------------------- | ------- | ----------------------------------------- | ------------------------------------------ |
| `backgroundImageURL` | string  | _(empty)_                                 | Background image for the instance.         |
| `logoURL`            | string  | _(empty)_                                 | Logo shown in the header.                  |
| `metaDomain`         | string  | `https://your-domain.com`                 | Domain used for SEO meta tags.             |
| `metaDescription`    | string  | `description for please-change-me.com 🚀` | Meta description.                          |
| `metaKeywords`       | string  | `comma, separated, keywords, …`           | Meta keywords.                             |
| `metaTwitterHandle`  | string  | `@your-twitter-handle`                    | Twitter/X handle used in embeds.           |

### Other

| Setting                | Type    | Default          | Description                                                                                               |
| ---------------------- | ------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `generateZips`         | boolean | `true`           | Allow generating ZIP archives from public albums.                                                         |
| `useUrlShortener`      | boolean | `false`          | Enable the built-in URL shortener.                                                                        |
| `generatedAlbumLength` | number  | `6`              | Length of generated album identifiers (≥ 4 recommended).                                                  |
| `generatedLinksLength` | number  | `8`              | Length of generated short-link identifiers (≥ 8 recommended).                                             |
| `defaultSortOrder`     | select  | `createdAt:desc` | Default sort order inside albums (`createdAt:desc`, `createdAt:asc`, `name:asc`, `name:desc`, `id:desc`). |

### Legal

These three accept **Markdown** and are shown as standalone pages. Leave a value empty to disable the page.

| Setting                     | Description                           |
| --------------------------- | ------------------------------------- |
| `privacyPolicyPageContent`  | Content of the privacy-policy page.   |
| `termsOfServicePageContent` | Content of the terms-of-service page. |
| `rulesPageContent`          | Content of the rules page.            |
