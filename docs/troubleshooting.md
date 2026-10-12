# Troubleshooting

## First: where to look

Before diving in, gather information:

```bash
docker compose logs -f            # nginx + backend + frontend in one stream
curl http://localhost:24424/api/health
curl http://localhost:24424/api/admin/service/diagnostic -H "X-API-KEY: <your key>"
```

The **diagnostic** endpoint reports environment details (Node version, `ffmpeg` availability, free space, database path, …). Logs are also written to `/app/logs` (daily rotating files).

## Login & accounts

**I can't log in as `admin`.** `ADMIN_PASSWORD` is only honoured the _first_ time the container starts, when no database exists. If a database already exists, change the password through **Admin → Account** (or delete `/app/database/database.sqlite` to start over — this deletes all data).

**`401 No authorization header provided` / `Invalid token`.** There is no JWT cookie and no `Authorization` header. Send `Authorization: Bearer <token>` or the `token` cookie. Note that **changing your password invalidates every existing token**.

**`403 User is disabled`.** An admin disabled the account; re-enable it from **Admin → Users**.

**`403` on an admin call.** Your account does not hold the `admin` role. Promote/demote requires the `owner` role.

## Uploads

**Uploads fail behind a proxy.** The bundled nginx streams bodies without buffering, but an _external_ proxy (Cloudflare, Traefik, another nginx) may impose its own body limit. Raise or disable it there. Also raise **Max Size** in `Admin → Settings`.

**Large uploads stall or time out.** Increase `chunkedUploadsTimeout` in the settings, and make sure the proxy's read/send timeouts are long enough (the bundled nginx uses 600s).

**`413 Request Entity Too Large`.** Almost always an upstream proxy limit, not SafeStorage.

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

## Container & operations

**"Port is already allocated".** Another process uses the host port. Change `SAFESTORAGE_PORT` in `docker/.env` and `docker compose up -d`.

**The container is `unhealthy`.** The healthcheck requires both `GET /api/health` and `/` to answer through nginx. Check the logs — usually the backend failed to start (bad env, migration error) or the frontend build is missing. Give it up to 60s on first boot.

**`Permission denied` writing uploads / database.** The bind-mounted folders are created by Docker as `root`. Either create `uploads/`, `database/` and `logs/` yourself with the right ownership before `up`, or run the container as a user that can write them.

**The database is busy / migrations fail.** Only one process should hold the SQLite file. If you run migrations yourself, set `SKIP_MIGRATIONS=1` so the entrypoint does not run them too.

**Files uploaded anonymously "disappeared".** Uploads made without being logged in only appear for you if **public mode** ties them to a session; otherwise they are public/unowned. Log in before uploading to keep them in your account.

**The `/docs` API reference is blank or 404s.** nginx routes `/docs` to the backend — verify the backend is up (`/api/health`) and that your external proxy forwards `/docs` too.

**Public album / short link / snippet returns 404.** The identifier is wrong or the resource was deleted. Generated links use the configured `serveUploadsFrom` / `metaDomain`, so make sure those point at the real domain.

## Starting over

To fully reset an instance (⚠️ deletes everything):

```bash
docker compose down
rm -rf uploads database logs
docker compose up -d
```

On the next boot a fresh database is created and the `admin` user is seeded from `ADMIN_PASSWORD`.

## Still stuck?

1. Reproduce with `docker compose logs -f` open.
2. Capture the output of `GET /api/admin/service/diagnostic`.
3. Open an issue at <https://github.com/ivancarlosti/safestorage/issues> with those details and your setup (image tag, hosting, proxy).
