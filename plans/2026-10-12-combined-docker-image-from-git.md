# One combined image, built from this repository

**Status:** implemented
**Date:** 2026-10-12

## Goal

`ivancarlosti/safestorage` must ship **one** image that contains the whole
application (nginx + Fastify backend + Next.js frontend), built from this
repository's source and published to `ghcr.io/ivancarlosti/safestorage`.
`/docker/` only _pulls_ it (see `2026-10-12-docker-folder-compose-only.md`).

Hard constraint: **`.github/workflows/build.yml` is not touched.** It already
builds the root `Dockerfile` (`context: .`) with the `VERSION` and `COMMIT`
build args and pushes `ghcr.io/ivancarlosti/safestorage:<version>` + `:latest`,
so the Dockerfile has to accept exactly those args and stay at the repo root.

## Decision

A two-stage root `Dockerfile` replaces the upstream three-container stack
(`frontend` + `backend` + `caddy`):

### Stage 1 — `builder` (`node:20-alpine`)

1. `COPY . .` and `yarn install --immutable`. Yarn 4 is vendored in the repo
   (`.yarn/releases/yarn-4.1.1.cjs` + `yarnPath` in `.yarnrc.yml`), so the
   Corepack shim that ships with the Node image runs the pinned version without
   downloading anything. `ENV CI=true` neutralises the root `postinstall`
   (`is-ci || husky`) because the build context has no `.git`.
2. **Stamp the release before building:** `VERSION` is written into the root
   `package.json` (the backend reads the version from there at runtime through
   `@/utils/Util.js`, and `/api/version` + the startup log use it) and
   `next.config.mjs` bakes the same `package.json` version in as
   `NEXT_PUBLIC_VERSION` during `next build`. `.version`/`.commit` are also
   written for the entrypoint banner.
3. `yarn workspace @safestorage/backend generate && yarn workspace @safestorage/backend build`
   — Prisma must generate the client before `tsc` because the backend imports
   types from `@prisma/client`.
4. `yarn workspace @safestorage/next build` — `next.config.mjs` sets
   `output: 'standalone'`, so `.next/standalone` holds `server.js` plus the
   traced `node_modules` subtree.
5. `yarn workspaces focus @safestorage/backend` drops every dependency only the
   frontend needed (the standalone bundle carries its own `node_modules`), then
   the Prisma client is generated again because focusing pruned it. The Prisma
   **CLI** stays available: the entrypoint applies migrations on start.

### Stage 2 — `runner` (`node:20-alpine`)

`apk add nginx supervisor ffmpeg openssl libc6-compat` and then:

| Copied                                                                          | From    | Why                                                     |
| ------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| `/app/packages/backend/dist`                                                    | builder | compiled backend                                        |
| `/app/packages/backend/src/prisma`                                              | builder | schema + migrations for `prisma migrate deploy`         |
| `/app/node_modules`, `/app/packages/backend/node_modules`                       | builder | focused backend dependencies + Prisma CLI               |
| `/app/packages/next/.next/standalone` → `/app/frontend`                         | builder | Next.js standalone server                               |
| `.next/static`, `public` → `/app/frontend/packages/next/...`                    | builder | `next build` does **not** copy these into `standalone/` |
| `container/nginx.conf`, `container/supervisord.conf`, `container/entrypoint.sh` | context | container plumbing                                      |

`nginx -t` runs at the end of the build, so a broken proxy config fails the
image instead of the container.

## Runtime layout

`container/supervisord.conf` runs three processes (all logging to stdout, so
`docker logs` shows everything):

| Program    | Command                                              | Listens on        |
| ---------- | ---------------------------------------------------- | ----------------- |
| `backend`  | `node dist/main.js` (cwd `/app/packages/backend`)    | `127.0.0.1:8000`  |
| `frontend` | `node packages/next/server.js` (cwd `/app/frontend`) | `127.0.0.1:8001`  |
| `nginx`    | `nginx -g "daemon off;"`                             | `:80` (published) |

`container/entrypoint.sh` creates `/app/uploads/{live,tmp,zips,thumbs/preview}`,
`/app/database`, `/app/logs`, applies `prisma migrate deploy` (skippable via
`SKIP_MIGRATIONS`) and then `exec`es supervisord.

Environment baked into the image: `NODE_ENV=production`, `HOST=0.0.0.0`,
`PORT=8000`, `BASE_API_URL=http://127.0.0.1:8000` (nginx proxies `/api` to the
backend internally, the frontend never talks to a public API URL),
`SAFESTORAGE_VERSION`/`SAFESTORAGE_COMMIT`.

`HEALTHCHECK` hits `http://127.0.0.1/api/health` (Fastify, through nginx) and
`http://127.0.0.1/` (Next.js, through nginx), so one probe covers all three
processes. `EXPOSE 80`.

## Files

| File                                                                      | Change                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                                                              | rewritten: combined 2-stage image, `VERSION`/`COMMIT` args, `nginx -t` gate                                                                                                             |
| `.dockerignore`                                                           | exclude `**/node_modules`, `**/dist`, `**/.next`, `docker/{uploads,database,logs}`, `.git`, `docs`, `plans`, `*.md`                                                                     |
| `container/nginx.conf`                                                    | single entrypoint: `/api` + `/docs` → backend, `/uploads` + `/thumbs` + `/live` → files, fall-through → Next, `client_max_body_size 0` so big uploads stay on the app/free-space checks |
| `container/supervisord.conf`                                              | backend + frontend + nginx, stdout logging, exit-on-failure                                                                                                                             |
| `container/entrypoint.sh`                                                 | directory bootstrap, migration, `exec supervisord`                                                                                                                                      |
| `docker/docker-compose.yml`                                               | pull-only `image: ghcr.io/ivancarlosti/safestorage:latest`, `24424:80`, bind mounts for `uploads`/`database`/`logs`                                                                     |
| `docker/.env.example`, `docker/README.md`                                 | documented single-container setup                                                                                                                                                       |
| `packages/backend/src/routes/files/Upload.ts`                             | S3 uploads above the 5 GiB single-PUT ceiling now go through a real multipart upload; network-storage handler hardened against non-JSON bodies                                          |
| `packages/backend/src/routes/files/UploadMultipartComplete.ts`            | new `POST /api/upload/multipart/complete`; lists the uploaded parts with `ListParts` and completes the multipart upload                                                                 |
| `packages/backend/src/routes/files/UploadProcess.ts`                      | body schema no longer forces the optional `sourceUrl`, which made every network-storage upload fail at the final step                                                                   |
| `packages/backend/src/routes/admin/service/SaveSettings.ts`               | partial settings updates no longer overwrite `chunkSize`/`maxSize`/`usersStorageQuota` with `"undefined"` (which read back as `NaN`)                                                    |
| `packages/next/src/lib/s3-multipart.ts`                                   | new browser-side multipart helper (XHR `PUT` per part, 2 in parallel, 3 attempts per part)                                                                                              |
| `packages/next/src/lib/dropzone.ts`                                       | `getSignedUrl` returns the multipart upload target when the backend asked for one                                                                                                       |
| `packages/next/src/hooks/useUploadFile.ts`                                | drives the multipart flow, reports progress per part, calls the complete endpoint                                                                                                       |
| `packages/next/src/components/{UploadTrigger,AlbumDropzone,Dropzone}.tsx` | pass the signed-url union through to the hook                                                                                                                                           |

## Verification

All of this was run on the de-forked tree:

1. `docker build --build-arg VERSION=test --build-arg COMMIT=local -t safestorage:test .`
   finishes (yarn install, Prisma generate, backend `tsc`, Next standalone build,
   `nginx -t` inside the image).
2. `docker compose --env-file docker/.env.example -f docker/docker-compose.yml config`
   parses cleanly (see `2026-10-12-docker-folder-compose-only.md`).
3. Smoke test on the built image
   (`docker run -e ADMIN_PASSWORD=… -p 24425:80 -v …/uploads:/app/uploads …`):
   migrations applied, supervisord runs nginx + backend + frontend, and through
   port 80 `/` → `200` (Next), `/api/health` → `200 {"status":"yes"}`,
   `/api/version` → `200 {"version":"test"}`, `/api/settings` → `200`,
   `/docs` → `200`, `/thumbs/` → `308`. `docker inspect … Health.Status` →
   `healthy`.
4. Uploads end to end on the same container: a 2.5 GiB chunked upload lands in
   `/app/uploads` (byte-identical, `Range` downloads work) and the full network
   storage / S3 multipart flow succeeds against an S3 stub. Both are documented
   with hashes in `2026-10-12-upload-over-2gb.md`.

## Limitations

-   Everything runs as `root` inside the container; the volumes are owned by root
    unless the host directories are prepared otherwise.
-   No TLS inside the image — put a reverse proxy / tunnel in front for HTTPS.
-   `docker compose` bind-mounts host directories, so no named volumes and no
    container-internal backup path; `docker/{uploads,database,logs}` in the repo
    are only _example_ paths (copy `docker/.env.example` and adjust `COMPOSE_DIR`).
-   The image is built from the git checkout; a rebuild is required for every
    source change (that is exactly what `build.yml` automates).
