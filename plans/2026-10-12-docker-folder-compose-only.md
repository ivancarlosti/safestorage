# `/docker`: pull-only compose setup

**Status:** implemented
**Date:** 2026-10-12

## Goal

Users who only want to _run_ SafeStorage should not need the source tree, a
`Dockerfile`, or the old three-container stack (frontend + backend + Caddy).
`/docker/` must contain a **compose-only, pull-only** setup.

## Contents

```
docker/
├── docker-compose.yml   # pulls ghcr.io/ivancarlosti/safestorage:latest
├── .env.example         # copy to .env and edit
└── README.md            # 10-line quick start
```

## Design

-   **Image:** `ghcr.io/ivancarlosti/safestorage:${SAFESTORAGE_TAG:-latest}` —
    one container runs nginx + Next.js + Fastify (see
    `2026-10-12-combined-docker-image-from-git.md`). No `build:` section
    anywhere, so `docker compose pull && docker compose up -d` always works and
    never needs the repository.
-   **Published port:** a single mapping, `${SAFESTORAGE_PORT:-24424}:80`.
    Everything (frontend, `/api`, `/docs`, uploads/thumbs) is behind that port.
-   **Volumes:** `./uploads`, `./database`, `./logs` bind mounts, matching the
    paths the application expects (`/app/uploads`, `/app/database`, `/app/logs`).
    They are created next to the compose file by Docker on first start.
-   **Environment:**
    -   `ADMIN_PASSWORD` – password for the auto-created admin user on first boot.
    -   `PORT`/`HOST` are fixed to `8000`/`0.0.0.0` inside the image; the frontend
        talks to the backend over the internal loopback, so `BASE_API_URL` is
        **not** user configurable (it defaults to `http://127.0.0.1:8000`).
    -   `PUID`/`PGID` are not needed: the image runs everything as root inside the
        container and the bind mounts are created by Docker. (Advanced users can set
        `user:` in a compose override.)
-   **Healthcheck:** `GET /api/health` through port 80 verifies nginx _and_
    Fastify in one probe (plus `/` for the Next.js frontend);
    `restart: unless-stopped` keeps it alive.
-   **`stop_grace_period`** is raised so ongoing uploads can finish writing before
    SIGKILL.

## Verification

-   `docker compose --env-file .env.example -f docker/docker-compose.yml config`
    parses cleanly (image `ghcr.io/ivancarlosti/safestorage:latest`, port
    `24424:80`, the three bind mounts, `stop_grace_period: 2m`, healthcheck);
    there is no `build:` section, so `docker compose pull` is the only way to get
    the image.
-   Healthcheck confirmed on a running container built from the same Dockerfile:
    `docker inspect … --format '{{.State.Health.Status}}'` reports `healthy`, and
    both probes (`/api/health` via Fastify and `/` via Next, both through nginx)
    answer `200` using the busybox `wget` that ships with `node:20-alpine`.
-   Manual run: first boot creates the admin user with `ADMIN_PASSWORD`, the UI is
    reachable on the mapped port, uploads land in `./uploads` (verified with the
    2.5 GiB chunked upload in `2026-10-12-upload-over-2gb.md`) and the SQLite file
    appears in `./database`.
-   See `2026-10-12-combined-docker-image-from-git.md` for the full smoke matrix
    (`/`, `/api/health`, `/api/version`, `/api/settings`, `/docs`, `/thumbs/`).

## Limitations

-   No MinIO/S3 helper services are shipped in this compose file; network storage
    is configured in the admin panel with an external bucket.
-   The compose file does not build images on purpose — building from source is
    the Dockerfile's job (and CI's).
