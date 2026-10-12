# @safestorage/next

The SafeStorage web UI — a Next.js 14 (App Router) application built with React 18, TypeScript, Tailwind CSS and Radix UI primitives.

See the repository root [`README.md`](../../README.md) for the project overview and the [`docs/`](../../docs) folder for the API, deployment, storage and development guides.

## Scripts

| Script                                    | What it does                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `yarn dev`                                | Dev server on <http://localhost:8001> (proxies `/api` to `BASE_API_URL`). |
| `yarn build`                              | Production build (`output: 'standalone'`).                                |
| `yarn start`                              | Start the production server on port 8001.                                 |
| `yarn lint` / `yarn lint:fix`             | Run `next lint` (optionally with `--fix`).                                |
| `yarn typecheck`                          | Run `tsc --noEmit`.                                                       |
| `yarn format:check` / `yarn format:write` | Check / apply Prettier formatting.                                        |

## Environment

`BASE_API_URL` points the development `/api` rewrite at the backend (default `http://localhost:8000`). It is only used in development — in production nginx routes `/api` and `/docs` to the backend directly, so no rewrite is needed.

Run it from the repository root with `yarn dev:frontend` when you want to control the processes separately; `yarn dev` (Turborepo) starts the backend and frontend together.
