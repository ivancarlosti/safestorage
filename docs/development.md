# Development

## Requirements

-   **Node.js ≥ 18.9.0** (the Docker image uses Node 20).
-   **Yarn 4** — vendored in the repository (`.yarn/releases`) and pinned via `packageManager: yarn@4.1.1`, so just run `yarn` (Enable Corepack if your shell cannot find it: `corepack enable`).
-   **ffmpeg** — optional; only needed for video thumbnail generation (`ffmpeg` is bundled in the Docker image).

## Repository layout

This is a Yarn 4 **monorepo** with four top-level parts:

| Path                | Workspace              | Purpose                                                     |
| ------------------- | ---------------------- | ----------------------------------------------------------- |
| `packages/backend/` | `@safestorage/backend` | Fastify API, Prisma/SQLite, uploads, thumbnails, cron jobs. |
| `packages/next/`    | `@safestorage/next`    | Next.js 14 App Router frontend (standalone output).         |
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

Then create the SQLite database and generate the Prisma client:

```bash
yarn migrate        # prisma migrate deploy && prisma generate
```

The database file lands at `database/database.sqlite` (relative to the repo root, per the Prisma schema).

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

The first time a user is created, an `admin` account is seeded with the password from `ADMIN_PASSWORD` (or `admin`). The production `start` script loads a root `.env` file via dotenv; during `dev`, set variables such as `PORT` and `ADMIN_PASSWORD` in your shell instead. The frontend reads `BASE_API_URL` from `packages/next/.env.local` (gitignored).

## Root scripts

| Script                                 | What it does                                                    |
| -------------------------------------- | --------------------------------------------------------------- |
| `yarn dev`                             | Run every workspace's dev server (Turborepo).                   |
| `yarn build`                           | Build every workspace.                                          |
| `yarn lint`                            | Lint every workspace (Prettier check + ESLint for the backend). |
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
| `yarn build`       | `rimraf dist && tsc && tsc-alias` — compile to `dist/`. |
| `yarn dev`         | `tsx watch src/main.ts`.                                |
| `yarn lint`        | `prettier --check .` + `eslint src --ext .ts`.          |
| `yarn format`      | `prettier --write .` + `eslint src --ext .ts --fix`.    |
| `yarn studio`      | Open Prisma Studio.                                     |
| `yarn migrate:dev` | Create/apply a dev migration and regenerate the client. |

**Frontend** (`packages/next`):

| Script                               | What it does                            |
| ------------------------------------ | --------------------------------------- |
| `yarn dev`                           | `next dev -p 8001`.                     |
| `yarn build` / `start`               | Production build / server on port 8001. |
| `yarn lint` / `lint:fix`             | `next lint` (optionally with `--fix`).  |
| `yarn typecheck`                     | `tsc --noEmit`.                         |
| `yarn format:check` / `format:write` | Prettier check / apply.                 |

## Code style

-   **Tabs** for indentation, single quotes, semicolons (see `.editorconfig` / Prettier config).
-   **Prettier** formats Markdown, JSON, TS and TSX. The frontend also sorts imports with `@ianvs/prettier-plugin-sort-imports`.
-   **ESLint** uses `eslint-config-neon` for the backend and `next lint` for the frontend.
-   Ignore files: `.prettierignore`, `.gitignore` and `packages/next/.eslintignore`.

Before opening a pull request, run:

```bash
yarn lint
yarn build
```

## Database changes

1. Edit `packages/backend/src/prisma/schema.prisma`.
2. `yarn workspace @safestorage/backend migrate:dev` to create the migration and apply it locally.
3. Commit the generated SQL under `packages/backend/src/prisma/migrations/`.
4. The container applies pending migrations automatically on start (`prisma migrate deploy`).

## Releases

-   **`semantic-release.yml`** drives versioning and changelogs from [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, …). Write commit messages accordingly.
-   **`build.yml`** runs on every published release: it zips the source, uploads it to the GitHub release, and builds/pushes the multi-arch image to `ghcr.io/ivancarlosti/safestorage`.
-   **`update-readme.yml`** syncs the README's `<!-- buttons -->` / `<!-- footer -->` blocks from the `ivancarlosti/.github` template — keep those markers intact in `README.md`.
