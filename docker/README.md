# SafeStorage with Docker (pull only)

This folder contains everything needed to run SafeStorage **without the source
code**: one combined image (nginx + backend + frontend) is pulled from
`ghcr.io/ivancarlosti/safestorage`.

## Quick start

```bash
cp .env.example .env   # edit ADMIN_PASSWORD and SAFESTORAGE_PORT
docker compose pull
docker compose up -d
```

Open `http://<host>:<SAFESTORAGE_PORT>` (default `24424`) and log in as `admin`
with the `ADMIN_PASSWORD` you configured.

## Data

Everything persistent lives next to this file:

| Folder     | Container path  | Contents                |
| ---------- | --------------- | ----------------------- |
| `uploads`  | `/app/uploads`  | files, thumbnails, zips |
| `database` | `/app/database` | `database.sqlite`       |
| `logs`     | `/app/logs`     | daily rotating logs     |

Back up those three folders and you have a full backup.

## Operations

```bash
docker compose logs -f          # all logs (nginx, backend, frontend)
docker compose pull && docker compose up -d   # update
docker compose down             # stop (data stays on disk)
```

## Notes

-   TLS is **not** terminated in this container. Put it behind a reverse proxy
    (Traefik, Caddy, nginx, Cloudflare Tunnel, …) if you need HTTPS.
-   Files larger than 2 GB work out of the box: the bundled nginx streams request
    bodies without buffering them. The upload limit itself is the _Max Size_
    setting in `Admin > Settings`, so raise it for really large files.
-   Uploads to a network storage (S3/R2/Spaces/MinIO) go straight from the browser
    to the bucket: files up to 100 MiB use one pre-signed `PUT`, bigger files a real
    S3 multipart upload (2 parts at a time, failing parts retried, 12 h URL
    lifetime), so there is no 5 GB single-`PUT` ceiling. The backend collects the
    ETags itself, so the bucket does **not** need `ExposeHeaders: ETag` in its CORS
    rules.
-   When the network storage is enabled _all_ uploads go to the bucket (chunked
    uploads to the local disk are only used when it is disabled), so raise
    _Max Size_ there too.
-   External S3/R2/Spaces/MinIO storage is configured in
    `Admin > Settings > Network storage`; no extra service is shipped here.
-   `uploads/`, `database/` and `logs/` are created automatically the first time
    you run `docker compose up` (Docker creates missing bind-mount sources as
    `root`); create them yourself beforehand if you need different ownership.
-   The container is healthy when `GET /api/health` (backend) and `/` (frontend)
    both answer through nginx; `docker compose ps` shows the status.
