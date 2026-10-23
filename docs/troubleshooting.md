# Troubleshooting

## First: where to look

Before diving in, gather information:

```bash
docker compose logs -f            # nginx + backend + frontend in one stream
curl http://localhost:24424/api/health
curl http://localhost:24424/api/admin/service/diagnostic -H "X-API-KEY: <your key>"
```

The **diagnostic** endpoint reports environment details (Node version, `ffmpeg` availability, free space, …). Logs are also written to `/app/logs` (daily rotating files).

## Login & accounts

**I can't log in at all after a fresh install.** There is no default account any more: the users are the ones declared in `ACCOUNT_LOGIN` on the first boot, and an instance that declares none has no users. Declare `ACCOUNT_LOGIN`/`ACCOUNT_PASSWORD`, recreate the container and sign in with that email. Deployments that already existed keep their users (including the old `admin` row) — change that password from **Admin → Users** if needed.

**There is no password form, only a single sign-on button.** The instance runs with `AUTH_METHOD=keycloak`, where the password form is removed on purpose — create the user in the identity provider instead. If you did not mean to, set `AUTH_METHOD=account` (or remove it) and recreate the container: the value is read at boot, so editing `.env` alone is not enough.

**The login page shows an error box right after a single sign-on attempt.** The `?error=` code in the URL says what happened:

| Code                 | Meaning                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `invalid_state`      | The login was stale, replayed or started on another instance — try again from the login page. |
| `invalid_token`      | The provider's response could not be verified (clock skew, wrong realm or client).          |
| `not_allowed`        | The email is not in `KEYCLOAK_RESTRICT`. Use **Log out and try another account** to end the provider session. |
| `email_not_verified` | The realm does not mark the address as verified.                                             |
| `user_disabled`      | The SafeStorage account is disabled — re-enable it in **Admin → Users**.                     |
| `invalid_request`    | The redirect came back without the expected `code`/`state` parameters.                        |

A page from the provider itself ("Invalid redirect URI") means `KEYCLOAK_REDIRECT_URI` and the client's _Valid redirect URI_ do not match exactly, scheme and trailing path included.

**Signing out shows "Invalid redirect URI" on the provider.** Ending the provider's session sends the browser back to `/login`, and Keycloak only accepts that target when it is registered: add `https://<your-domain>/login` to the client's _Valid post logout redirect URIs_. The provider may also ask "Do you want to log out?" first — that confirmation is expected, because the instance does not keep the `id_token` it would need to skip it.

**Signing in again silently uses the previous account.** The provider's own session outlives SafeStorage's cookie. Use **Sign out** in the user menu (or the logout button on the error box) instead of just closing the tab: both go through `/api/auth/keycloak/logout`, which deletes the cookie and ends the provider session.

**The container refuses to start with `AUTH_METHOD=keycloak needs KEYCLOAK_RESTRICT ...`.** That check exists so the first visitor cannot quietly claim the `owner` role. Set `KEYCLOAK_RESTRICT` (whole emails or bare domains), or declare the accounts you trust in `ACCOUNT_LOGIN`.

**The password form rejects a password I never set.** An `ACCOUNT_LOGIN` entry without a matching `ACCOUNT_PASSWORD` gets a random one. Log in with the password an admin sets in **Admin → Users** (or from the Credentials page) — after that, the `ACCOUNT_PASSWORD` value keeps working as a recovery credential.

**`400 The reCAPTCHA validation failed`.** The site key/secret pair is configured but the browser produced no valid token: the Google script may be blocked by an extension or an upstream proxy, the page may have been submitted twice (tokens are single-use), or the keys are not a **v2** pair — a v3 key will not work, because the login form renders the v2 checkbox.

**`401 No authorization header provided` / `Invalid token`.** There is no JWT cookie and no `Authorization` header. Send `Authorization: Bearer <token>` or the `token` cookie. Note that **changing your password invalidates every existing token**.

**`403 User is disabled`.** An admin disabled the account; re-enable it from **Admin → Users**.

**`403` on an admin call.** Your account does not hold the `admin` role. Promote/demote requires the `owner` role.

## Uploads

**The upload panel reports failed uploads but the network tab is empty.** Files refused before they are sent (bigger than **Max Size**, blocked extension, instance settings still loading, network storage refusing to sign the request) never reach the backend, so nothing appears in the devtools and nothing shows up in `docker logs`. The reason is printed under the file name in the panel and as a toast — raise **Max Size** in `Admin → Settings` or fix the reported cause.

**Uploads fail behind a proxy.** The bundled nginx streams bodies without buffering, but an _external_ proxy (Cloudflare, Traefik, another nginx) may impose its own body limit. Raise or disable it there. Also raise **Max Size** in `Admin → Settings`.

**Large uploads stall or time out.** Increase `chunkedUploadsTimeout` in the settings, and make sure the proxy's read/send timeouts are long enough (the bundled nginx uses 600s).

**`413 Request Entity Too Large`.** The panel shows the reason the backend returned: `File is too big` means the upload is above **Max Size** (or the anonymous upload cap of a public link), `Chunk is too big` means a single request is above **Chunk Size**, and `Chunked upload is above size limit` means the file needs more chunks than the size limit allows — raise **Max Size** there. Any other `413` text comes from an upstream proxy that is limiting the request body; raise or disable its body limit, or lower **Chunk Size** below it.

**Video thumbnails are missing.** Video thumbnails require `ffmpeg`. It is bundled in the Docker image; for a source install, install `ffmpeg` and make sure it is on `PATH`. Confirm with the diagnostic endpoint.

**Extension blocked.** Files with a blocked extension (or no extension) are rejected by design — adjust `blockedExtensions` / `blockNoExtension` in the settings.

## Network / S3 storage

**Uploads to the bucket fail.** Check, in order:

1. `S3Endpoint` — **empty for AWS**, required for everything else.
2. `S3PathStyle` — usually `true` for non-AWS providers.
3. Bucket **CORS** allows `PUT` from your domain (see [Storage](storage.md)).
4. `S3PublicUrl` is set so generated links resolve.
5. `S3Region` / keys / bucket name are correct.

Note that when network storage is enabled **all** uploads go to the bucket, so also raise **Max Size** there.

## API & rate limits

**`429 Too Many Requests`.** The global rate limit was hit (default 100 requests / 1000 ms). Raise `rateLimitMax` / `rateLimitWindow` in the settings (a restart is required, since the limiter reads them at boot).

**API calls with an API key return `401`.** API keys go in the `X-API-KEY` header (`X-API-KEY: <key>`), not `Authorization`. Regenerate the key with `POST /api/auth/apikey/change` if it was rotated.

**Every request from one IP is rejected.** That IP may be banned — check **Admin → IPs** and unban it.

## Database

**The container exits with `DATABASE_URL is not set or is empty`.** The image ships no database of its own: pass a MariaDB/MySQL connection string (for example `mysql://user:password@host:3306/safestorage`), which in Compose is the `DATABASE_URL` key in `.env`.

**`P1001: Can't reach database server`.** The host or port in `DATABASE_URL` is wrong, or the server only listens on its own loopback. `localhost` inside the container is the container itself — to reach a database on the Docker host use `host.docker.internal` (the shipped `docker-compose.yml` maps that name to the host gateway), or, for another Compose project, the database's service name on a shared network. Slow database? The entrypoint retries for `DB_WAIT_ATTEMPTS` × 2 s (2 minutes by default) before giving up.

**`P1010` / `Access denied for user`.** Wrong user or password, or the user may not connect from the container's address (check the `%` vs `localhost` host part of the MariaDB grant). Try the same credentials with `mariadb -h <host> -P <port> -u <user> -p`.

**The database does not exist yet.** Not a problem: `prisma migrate deploy` creates it, as long as the user is allowed to. If it is not, create it once by hand (`CREATE DATABASE safestorage CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`) and restart the container.

**`P2025 ... Expected 2 records to be connected, found only 0` on the first boot.** The built-in `roles` rows are missing, which means the seed migration did not run — typically because `SKIP_MIGRATIONS=1` was set on an empty database. Restart once without it.

**`Data too long for column '...'`.** The column is `VARCHAR(191)`, Prisma's default for `String`. Widen it with an explicit native type and a migration, see [Development](development.md#database-changes).

**`Unknown collation` / emoji break the UI.** The tables are created as `utf8mb4`; if you create databases by hand, use `utf8mb4` there too (the bundled Compose file sets it on the server).

**Migrations report "No pending migrations" but a table is missing.** The `_prisma_migrations` table no longer matches the schema (restored backup, manual SQL). Run `prisma migrate status` with `DATABASE_URL` set, and mark the already-applied migrations with `prisma migrate resolve --applied <migration>`.

## Container & operations

**"Port is already allocated".** Another process uses the host port. Change `SAFESTORAGE_PORT` in `docker/.env` and `docker compose up -d`.

**The container is `unhealthy`.** The healthcheck requires both `GET /api/health` and `/` to answer through nginx. Check the logs — usually the backend failed to start (bad env, migration error) or the frontend build is missing. Give it up to 60s on first boot.

**`Permission denied` writing uploads.** The bind-mounted folders are created by Docker as `root`. Either create `uploads/` and `logs/` yourself with the right ownership before `up`, or run the container as a user that can write them.

**Migrations fail because another process is running them.** Only one party should own the schema: if you apply migrations yourself, set `SKIP_MIGRATIONS=1` so the entrypoint does not run them too.

**Files uploaded anonymously "disappeared".** Uploads made without being logged in only appear for you if **public mode** ties them to a session; otherwise they are public/unowned. Log in before uploading to keep them in your account.

**The `/docs` API reference is blank or 404s.** nginx routes `/docs` to the backend — verify the backend is up (`/api/health`) and that your external proxy forwards `/docs` too.

**Public album / short link / snippet returns 404.** The identifier is wrong or the resource was deleted. Generated links use the configured `serveUploadsFrom` / `metaDomain`, so make sure those point at the real domain.

## Starting over

To fully reset an instance (⚠️ deletes everything):

```bash
# bundled database: also removes the `mariadb` volume
docker compose -f docker-compose-bundle.yml down -v

# external database: drop and recreate the schema by hand
mariadb -h <host> -u <user> -p -e 'DROP DATABASE safestorage; CREATE DATABASE safestorage CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'

rm -rf uploads logs
docker compose -f docker-compose-bundle.yml up -d     # or `docker compose up -d`
```

On the next boot the schema and the built-in roles are created from scratch, together with the accounts declared in `ACCOUNT_LOGIN` (there is no default account).

## Still stuck?

1. Reproduce with `docker compose logs -f` open.
2. Capture the output of `GET /api/admin/service/diagnostic`.
3. Open an issue at <https://github.com/ivancarlosti/safestorage/issues> with those details and your setup (image tag, hosting, proxy).
