# Development

## Requirements

-   **Node.js ≥ 22.19.0** (the Docker image uses Node 22; `jotai` 3 requires 22.12+, and `@scalar/fastify-api-reference` 1.76 pulls `@scalar/json-magic`/`undici`, which declare 22.19+).
-   **Yarn 4** — vendored in the repository (`.yarn/releases`) and pinned via `packageManager: yarn@4.1.1`, so just run `yarn` (Enable Corepack if your shell cannot find it: `corepack enable`).
-   **MariaDB 10.5+ / MySQL 8** — reachable from your machine: installed locally, running in a container, or managed. See [Setup](#setup) for a one-liner that starts a throwaway server.
-   **ffmpeg** — optional; only needed for video thumbnail generation (`ffmpeg` is bundled in the Docker image).

## Repository layout

This is a Yarn 4 **monorepo** with these top-level parts:

| Path                | Workspace              | Purpose                                                     |
| ------------------- | ---------------------- | ----------------------------------------------------------- |
| `packages/backend/` | `@safestorage/backend` | Fastify API, Prisma + MariaDB/MySQL, uploads, thumbnails, cron jobs. |
| `packages/next/`    | `@safestorage/next`    | Next.js 14 App Router frontend (standalone output).         |
| `packages/uploader-module/` | `@safestorage/uploader-module` | Server-side chunked upload handler (busboy).       |
| `packages/uploader-client/` | `@safestorage/uploader-client` | Browser-side chunked upload client.                |
| `container/`        | —                      | nginx + supervisord + entrypoint used by the Docker image.  |
| `docker/`           | —                      | Pull-only Compose stack for end users.                      |
| `docs/`             | —                      | This documentation.                                         |

Turborepo (`turbo.json`) orchestrates the workspace scripts.

## Setup

```bash
git clone https://github.com/ivancarlosti/safestorage.git
cd safestorage
yarn install
```

Then point the backend at a database and create the schema:

```bash
export DATABASE_URL="mysql://safestorage:safestorage@127.0.0.1:3306/safestorage"
yarn migrate        # prisma migrate deploy && prisma generate
```

`DATABASE_URL` is a standard MariaDB/MySQL connection string and the single source of truth: `packages/backend/prisma.config.ts` reads it for the CLI (`prisma migrate`, `prisma generate`) and `src/structures/database.ts` hands it to the `@prisma/adapter-mariadb` driver adapter at runtime. The generated Prisma client is written to `packages/backend/src/generated/prisma` (git-ignored).

Don't have a server yet? This starts a throwaway one on port 3306 that matches the URL above:

```bash
docker run -d --name safestorage-dev-db -p 3306:3306 \
  -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=safestorage \
  -e MARIADB_USER=safestorage -e MARIADB_PASSWORD=safestorage \
  mariadb:11.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

The user has to be allowed to create the database (Prisma does that for you, so does the image's `MARIADB_DATABASE`).

## Running locally

```bash
yarn dev            # turbo run dev -> backend + frontend together
```

-   **Backend** — Fastify on <http://localhost:8000> (via `tsx watch`, so it hot-reloads).
-   **Frontend** — Next.js on <http://localhost:8001>; the dev rewrite proxies `/api/*` to `BASE_API_URL` (default `http://localhost:8000`).

Or run them separately:

```bash
yarn dev:backend
yarn dev:frontend
```

The first time the backend starts it creates the accounts declared in `ACCOUNT_LOGIN`, with the positionally matched `ACCOUNT_PASSWORD`. There is no default account, so an empty database without `ACCOUNT_LOGIN` stays without users on purpose. The production `start` script loads a root `.env` file via dotenv; during `dev`, set variables such as `DATABASE_URL`, `PORT`, `ACCOUNT_LOGIN`/`ACCOUNT_PASSWORD` (plus `AUTH_METHOD=keycloak` with its `KEYCLOAK_*`, or the `RECAPTCHA_*` pair — see [Configuration → Authentication](configuration.md#authentication)) in your shell instead. The frontend reads `BASE_API_URL` from `packages/next/.env.local` (gitignored).

## Root scripts

| Script                                 | What it does                                                    |
| -------------------------------------- | --------------------------------------------------------------- |
| `yarn dev`                             | Run every workspace's dev server (Turborepo).                   |
| `yarn build`                           | Build every workspace.                                          |
| `yarn lint`                            | Lint every workspace (ESLint; the backend also runs a Prettier check). |
| `yarn format`                          | Format every workspace.                                         |
| `yarn start`                           | Start the backend (`migrate` + `node dist/main.js`).            |
| `yarn generate`                        | Generate the Prisma client.                                     |
| `yarn migrate`                         | Apply migrations and regenerate the Prisma client.              |
| `yarn dev:backend` / `start:backend`   | Backend only.                                                   |
| `yarn dev:frontend` / `start:frontend` | Frontend only.                                                  |

## Per-package commands

**Backend** (`packages/backend`):

| Script             | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `yarn build`       | `rimraf dist && tsc && node scripts/rewrite-path-aliases.mjs` — compile and rewrite the `@/`/`~/` aliases into relative specifiers. |
| `yarn dev`         | `tsx watch src/main.ts`.                                |
| `yarn lint`        | `prettier --check .` + `eslint src`.                    |
| `yarn format`      | `prettier --write .` + `eslint src --fix`.              |
| `yarn studio`      | Open Prisma Studio.                                     |
| `yarn migrate:dev` | Create/apply a dev migration and regenerate the client. |

**Frontend** (`packages/next`):

| Script                               | What it does                            |
| ------------------------------------ | --------------------------------------- |
| `yarn dev`                           | `next dev -p 8001`.                     |
| `yarn build` / `start`               | Production build / server on port 8001. |
| `yarn lint` / `lint:fix`             | `eslint src` (optionally with `--fix`). |
| `yarn typecheck`                     | `tsc --noEmit`.                         |
| `yarn format:check` / `format:write` | Prettier check / apply.                 |

## Code style

-   **Tabs** for indentation, single quotes, semicolons (see `.editorconfig` / Prettier config).
-   **Prettier** formats Markdown, JSON, TS and TSX. The frontend also sorts imports with `@ianvs/prettier-plugin-sort-imports`.
-   **ESLint** runs from a hand-rolled flat config: `eslint.config.mjs` in the root is the shared base (`@eslint/js`, `typescript-eslint`, plus the `react`, `react-hooks`, `unicorn`, `promise`, `n` and `import-x` plugins, with `eslint-config-prettier` last), and each workspace adds its own layer on top. `next lint` is not used.
-   Ignore files: `.prettierignore`, `.gitignore` and the `ignores` entries in the `eslint.config.mjs` files.

Before opening a pull request, run:

```bash
yarn lint
yarn build
```

## Dependency security

Yarn 4's audit only walks the **direct** dependencies unless told otherwise, so
advisories that reach a workspace transitively stay invisible. Always audit the
full graph, high severity and above:

```bash
yarn npm audit -A -R --severity high
```

The same command runs in CI on every push and pull request against `main`, and
once a week on a schedule (`.github/workflows/audit.yml`).

When the patched release cannot be picked up by a normal range bump — for
example because an intermediate package pins an exact version — force it through
the root `resolutions` field. Scope the key by range when several majors are in
the tree at once, so a pinned major does not drag unrelated packages down:

```json
"resolutions": {
	"fast-uri@^3.0.1": "3.1.9",
	"fast-uri@^4.0.0": "4.2.3"
}
```

## Database changes

1. Edit `packages/backend/src/prisma/schema.prisma`.
2. `yarn workspace @safestorage/backend migrate:dev` to create the migration and apply it locally. `migrate dev` needs a throwaway database to diff the schema against: it creates one automatically with the credentials in `DATABASE_URL`, and only falls back to `SHADOW_DATABASE_URL` when that user is not allowed to create databases.
3. Commit the generated SQL under `packages/backend/src/prisma/migrations/`.
4. The container applies pending migrations automatically on start (`prisma migrate deploy`).

Two MySQL-specific things to keep in mind:

-   A plain `String` becomes `VARCHAR(191)`. Add an explicit native type (`@db.VarChar(n)`, `@db.Text`, `@db.LongText`) for anything longer, otherwise the insert fails with `Data too long for column` (or is silently truncated under a non-strict `sql_mode`).
-   Data that must exist before the application boots — the three rows in `roles`, see `20261014033039_seed_roles` — cannot be expressed in the schema. Add a migration with plain `INSERT` statements instead.

## Releases

-   **`semantic-release.yml`** drives versioning and changelogs from [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, …). Write commit messages accordingly.
-   **`build.yml`** runs on every published release: it zips the source, uploads it to the GitHub release, and builds/pushes the multi-arch image to `ghcr.io/ivancarlosti/safestorage`.
-   **`audit.yml`** runs `yarn npm audit -A -R --severity high` on every push and pull request against `main`, plus a weekly scheduled run, so new advisories in the transitive graph fail fast.
-   **`update-readme.yml`** syncs the README's `<!-- buttons -->` / `<!-- footer -->` blocks from the `ivancarlosti/.github` template — keep those markers intact in `README.md`.
