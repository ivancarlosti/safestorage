# Deployment

The recommended way to run SafeStorage is the **single combined Docker image**, published to the GitHub Container Registry as `ghcr.io/ivancarlosti/safestorage`. One container holds nginx (port 80), the Fastify backend and the Next.js frontend, managed by supervisord.

## Requirements

-   Docker with the Compose plugin (`docker compose`).
-   A place to store data (the three bind-mount folders below).
-   Optionally, a reverse proxy in front for TLS (see [TLS / reverse proxy](#tls--reverse-proxy)).

## Quick start (Docker Compose)

The [`docker/`](../docker) folder ships a ready-to-use, **pull-only** stack (it never builds anything):

```bash
cd docker
cp .env.example .env      # edit ADMIN_PASSWORD and SAFESTORAGE_PORT
docker compose pull
docker compose up -d
```

Open `http://<host>:<port>` (default `24424`) and log in as `admin` with the `ADMIN_PASSWORD` you set. The password is only used the **first** time the container starts, when no database exists yet.

### `.env` variables

| Variable           | Default  | Meaning                                                          |
| ------------------ | -------- | ---------------------------------------------------------------- |
| `SAFESTORAGE_PORT` | `24424`  | Host port published to the container's port 80.                  |
| `SAFESTORAGE_TAG`  | `latest` | Image tag to run (`latest` or a pinned release such as `1.1.0`). |
| `ADMIN_PASSWORD`   | `admin`  | Password of the auto-created `admin` user (first boot only).     |
| `TZ`               | `UTC`    | Timezone for container log timestamps.                           |

## Data & volumes

Everything persistent lives next to `docker-compose.yml`:

| Host folder | Container path  | Contents                      |
| ----------- | --------------- | ----------------------------- |
| `uploads/`  | `/app/uploads`  | files, thumbnails, live, zips |
| `database/` | `/app/database` | `database.sqlite`             |
| `logs/`     | `/app/logs`     | daily rotating logs           |

**Back up those three folders and you have a full backup.** Restore is the reverse: drop them back and start the container.

> The folders are created automatically on first `up` (Docker creates missing bind-mount sources as `root`). If you need a different ownership, create them yourself first.

## Updating

```bash
cd docker
docker compose pull
docker compose up -d
```

The image applies Prisma migrations automatically on start. `latest` tracks the newest release; pin `SAFESTORAGE_TAG` to a version if you prefer controlled upgrades.

## Operations

```bash
docker compose logs -f          # all logs (nginx, backend, frontend)
docker compose ps               # health status
docker compose down             # stop (data stays on disk)
docker compose up -d --build    # only if you switched to a build-based setup
```

The container is **healthy** when `GET /api/health` (backend) and `/` (frontend) both answer through nginx. The healthcheck runs every 30s with a 60s start-up grace period. Running uploads get up to 2 minutes to finish on stop (`stop_grace_period: 2m`).

## TLS / reverse proxy

TLS is **not** terminated inside this container, so put it behind any reverse proxy that can forward plain HTTP:

-   **Caddy** — `reverse_proxy safehost:24424` gets you automatic HTTPS in one line.
-   **nginx** — proxy to the published port and forward `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`.
-   **Traefik** / **Cloudflare Tunnel** — point at the published port.

After adding TLS, set **Admin → Settings → `serveUploadsFrom`** to the full public URL (e.g. `https://cdn.example.com`) so generated links use it.

## Large uploads

Files larger than 2 GB work out of the box: the bundled nginx streams request bodies without buffering (`client_max_body_size 0`, `proxy_request_buffering off`) and the backend supports chunked uploads. The effective ceiling is the **Max Size** setting in `Admin → Settings` — raise it for really large files.

## Building from source

If you would rather build the image yourself:

```bash
git clone https://github.com/ivancarlosti/safestorage.git
cd safestorage
docker build -t safestorage:local .
```

Then point a Compose service at `safestorage:local` instead of the GHCR image, or run it directly:

```bash
docker run -d \
  --name safestorage \
  -p 24424:80 \
  -e ADMIN_PASSWORD=change-me -e TZ=UTC \
  -v "$PWD/uploads:/app/uploads" \
  -v "$PWD/database:/app/database" \
  -v "$PWD/logs:/app/logs" \
  safestorage:local
```

The [`Dockerfile`](../Dockerfile) is a two-stage build: a `node:22-alpine` **builder** installs the Yarn 4 workspaces, generates the Prisma client, compiles the backend (`tsc`) and the Next.js standalone output, then prunes the frontend dependencies. The **runner** stage adds nginx, supervisor, ffmpeg and OpenSSL, copies the build outputs and the files from [`container/`](../container), and exposes port 80.

The release pipeline ([`.github/workflows/build.yml`](../.github/workflows/build.yml)) builds exactly this file for `linux/amd64` and `linux/arm64` on every published release, stamping `VERSION`/`COMMIT` into the image. The version is read at runtime from the root `package.json` (`/api/version`) and baked into the frontend as `NEXT_PUBLIC_VERSION` during `next build`.

### What runs inside

| Process  | Command                        | Listens on       | Role                             |
| -------- | ------------------------------ | ---------------- | -------------------------------- |
| nginx    | `nginx -g "daemon off;"`       | `0.0.0.0:80`     | Reverse proxy + static uploads   |
| backend  | `node dist/main.js`            | `127.0.0.1:8000` | Fastify API, uploads, thumbnails |
| frontend | `node packages/next/server.js` | `127.0.0.1:8001` | Next.js standalone server        |

Routing (from [`container/nginx.conf`](../container/nginx.conf)):

-   `/api/` and `/docs` → backend.
-   existing files under `/app/uploads` → served straight off disk (nginx handles Range requests).
-   everything else → frontend.

The entrypoint ([`container/entrypoint.sh`](../container/entrypoint.sh)) creates the writable folders, applies Prisma migrations and hands over to supervisord. All three processes log to stdout/stderr, so `docker logs` shows everything.

## Platform notes

-   **`linux/amd64` and `linux/arm64`** images are both published.
-   `ffmpeg` is included in the image, so video thumbnails work out of the box.
-   For non-Docker installs, see [Development](development.md) and make sure `ffmpeg` is on `PATH`.
