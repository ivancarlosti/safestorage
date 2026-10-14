# Architecture

SafeStorage is a TypeScript monorepo that ships as a single container. This page explains how the pieces fit together — useful if you are contributing or debugging.

## High-level picture

```
                    ┌──────────────────────────── one container ────────────────────────────┐
 browser ──:80──▶   │  nginx ──┬── /api/*, /docs ──▶ Fastify backend   (127.0.0.1:8000)        │
                    │          ├── /app/uploads/* ─▶ files served from disk                  │
                    │          └── everything else ─▶ Next.js frontend (127.0.0.1:8001)      │
                    └─────────────────────── supervisord keeps all three alive ────────────┘
```

-   **nginx** is the only process exposed to the network; it terminates no TLS (put it behind a proxy for HTTPS) and serves uploads directly from disk with Range-request support.
-   **Fastify** answers the API, performs uploads, generates thumbnails and runs the cron jobs (statistics, update check).
-   **Next.js** renders the web UI (standalone server).

## Repository layout

| Path                | Contents                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `packages/backend`  | Fastify API, Prisma schema + migrations, middleware, route modules, cron jobs, upload utils. |
| `packages/next`     | Next.js 14 (App Router) frontend: pages, components, Jotai stores, TanStack Query, Tailwind. |
| `packages/uploader-module` | Server-side chunked/busboy upload handler (vendored, first-party).                    |
| `packages/uploader-client` | Browser-side chunked upload client (vendored, first-party).                           |
| `container`         | `nginx.conf`, `supervisord.conf` and `entrypoint.sh` baked into the image.                   |
| `docker`            | `docker-compose.yml` (external database), `docker-compose-bundle.yml` (bundled MariaDB) and `.env.example` for operators. |
| `docs`              | This documentation.                                                                          |
| `.github/workflows` | Code review, release, image build, README sync, keepalive.                                   |

## Backend

The backend is a plain Fastify server built around a small, explicit structure:

-   **`main.ts`** — bootstraps Fastify (helmet, cors, cookies, static, Swagger + Scalar), creates the default admin user if missing, loads settings, registers routes and starts the scheduler.
-   **`structures/routes.ts`** — the route loader. It walks `src/routes`, and for every module exports `options.url` + `options.method`, it:

    1. prefixes the URL with `/api` (unless the route opts out via `ignoreRoutePrefix`),
    2. always prepends the `ban` middleware,
    3. resolves each declared middleware by name (optionally passing per-route options),
    4. registers the route with the Zod type provider and a per-route rate-limit config.

    Because routes are discovered from the filesystem, **adding a route is just adding a file** under `src/routes`.

-   **`middlewares/`** — `ban` (rejects banned IPs), `apiKey` (authenticates via `X-API-KEY`, optional), `auth` (JWT via cookie/header, supports `optional`), `admin` and `owner` (role checks).
-   **`structures/settings.ts`** — the `SETTINGS` singleton plus `SETTINGS_META` metadata; loaded from the database on boot.
-   **`structures/schemas`** — reusable Zod schemas extended by route schemas.
-   **`utils/`** — file handling, thumbnails, S3/multipart helpers, snippet rendering, logging, docs/OpenAPI definition, update check.
-   **`routes/`** — one module per endpoint, grouped by domain (`auth`, `user`, `album`, `files`, `tag`, `links`, `snippet`, `admin/*`, `health`).

### Request lifecycle

```
nginx ─▶ fastify preHandler chain ─▶ Zod validation ─▶ handler ─▶ Zod-serialized response
              ban → apiKey → auth → admin/owner
```

Rate limiting is applied globally (`@fastify/rate-limit`) with per-route overrides (login/register are stricter).

### Data model

Prisma with **MariaDB/MySQL**. The connection string lives in `DATABASE_URL` and is shared by the runtime and the CLI: `PrismaClient` gets the pure-JS `@prisma/adapter-mariadb` driver adapter (so no native module is compiled), and `packages/backend/prisma.config.ts` gives the same URL to `prisma migrate`. Models: `users`, `roles`, `files`, `quarantineFiles`, `snippets`, `shortenedLinks`, `albums`, `bans`, `links`, `settings`, `statistics`, `tags`, `invites`. Migrations live in `packages/backend/src/prisma/migrations` and are applied on container start. Tables are created as `utf8mb4` with the case-insensitive `utf8mb4_unicode_ci` collation, so `LIKE` keeps behaving the way it did on SQLite.

### Scheduled jobs

Cron jobs run in-process (`node-schedule`): nightly **statistics** collection and a daily **update check** against GitHub releases. Both can be disabled from the admin settings.

## Frontend

A Next.js 14 **App Router** application (`output: 'standalone'`):

-   **`src/app`** — routes: home (`(home)`), auth (`(auth)`), dashboard, `s/[identifier]` (public snippets), `a/…` (public albums), `l/…` (links), `compare/…`, `og/…` (Open Graph image generation).
-   **`src/components`** — UI built on Tailwind CSS + Radix UI primitives for overlays and form controls, with `react-aria-components` supplying the accessible drag-and-drop dropzone and file-trigger primitives (which have no Radix equivalent), plus app-specific components (upload dropzone, image grid, file viewer).
-   **`src/actions`** — server actions.
-   **`src/lib`** — API client helpers and utilities.
-   **`src/hooks`** — shared React hooks.
-   **`src/middleware.ts`** — routing/guard middleware.
-   Content pages (privacy policy, terms, rules) are MDX, enabled by `@next/mdx` in `next.config.mjs`.

Data fetching uses **TanStack Query**; client state uses **Jotai** (with `jotai-immer`). Uploads are handled by `@safestorage/uploader-client` (vendored in `packages/uploader-client`), which performs the chunked / pre-signed / multipart upload flows against the backend.

The frontend version is injected at build time (`NEXT_PUBLIC_VERSION`, read from the root `package.json`). In development only, `next.config.mjs` rewrites `/api/*` to `BASE_API_URL`; in production nginx routes `/api` directly, so the rewrite is disabled.

## Container

-   **`container/nginx.conf`** — single server block: `/api/` and `/docs` → backend, existing files under `/app/uploads` → disk, everything else → frontend. Bodies are streamed (`client_max_body_size 0`, no request buffering) to support multi-gigabyte uploads.
-   **`container/supervisord.conf`** — supervises `backend`, `frontend` and `nginx`, each logging to stdout/stderr.
-   **`container/entrypoint.sh`** — prints the version banner, creates the writable folders, requires `DATABASE_URL`, waits for MariaDB/MySQL to accept connections, applies Prisma migrations (unless `SKIP_MIGRATIONS` is set) and `exec`s supervisord.

See [Deployment](deployment.md) for the full build/run details.

## Configuration & data flow summary

| Concern          | Where it lives                                                               |
| ---------------- | ---------------------------------------------------------------------------- |
| Environment      | Process env (see [Configuration](configuration.md)).                         |
| Database         | External MariaDB/MySQL server, reached through `DATABASE_URL`.               |
| Runtime settings | `settings` table, cached in the `SETTINGS` singleton.                        |
| Persistent data  | `/app/uploads` and `/app/logs` (bind mounts/volumes) + the database server.  |
| Secrets          | JWT signing `secret` (settings) and `ADMIN_PASSWORD` (env, first boot only). |
