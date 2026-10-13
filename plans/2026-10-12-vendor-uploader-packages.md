# Vendored uploader packages (de-fork from chibisafe)

**Status:** implemented
**Date:** 2026-10-12

## Goal

Finish the de-fork: SafeStorage must not depend on the old project's npm
packages. `@chibisafe/uploader-module` and `@chibisafe/uploader-client` were the
last remaining `chibisafe`-branded dependencies. Their source now lives in this
repository as first-party Yarn workspaces and every identifier tied to the old
project was renamed.

## Where the source came from

Both packages were published from the separate upstream repo
[`chibisafe/uploader`](https://github.com/chibisafe/uploader). The published
`1.0.12` matches commit `f2d25b61d51e1a956d046970b29c0a5a6cd9764a` (both
packages' npm `gitHead`), so the exact TypeScript was recovered from that
commit. As a cross-check, the module also ships its original source in
`lib/index.js.map` (`sourcesContent`) — the two were diffed and are
byte-identical.

## Decision

- Two new workspaces: `packages/uploader-module` (`@safestorage/uploader-module`)
  and `packages/uploader-client` (`@safestorage/uploader-client`), both
  `private: true` and referenced with `workspace:*`.
- Keep the upstream build tooling so the emitted layout (`lib/index.js`,
  `lib/index.mjs`, `lib/index.d.ts`) is unchanged: `tsup` for the module,
  `vite` + `vite-plugin-dts` for the client.
- Full de-brand:

  | Old                                  | New                                             |
  | ------------------------------------ | ----------------------------------------------- |
  | `@chibisafe/uploader-module` / client | `@safestorage/uploader-module` / `-client`      |
  | exported `chibiUploader`              | exported `safeStorageUploader`                  |
  | headers `chibi-uuid` / `-chunk-number` / `-chunks-total` | `safestorage-uuid` / `-chunk-number` / `-chunks-total` |
  | banner `%c ChibiUploader ` / `[ChibiUploader]` | `%c SafeStorage Uploader ` / `[SafeStorage Uploader]` |

  The renamed wire headers are kept consistent across the module (reads them),
  the client (sets them), the backend Zod schema and the backend CORS
  `allowedHeaders`. This is safe: there are no legacy clients to stay
  compatible with.

## Files

- Added `packages/uploader-module/{package.json,tsconfig.json,tsup.config.ts,src/index.ts}`.
- Added `packages/uploader-client/{package.json,tsconfig.json,vite.config.ts,src/index.ts}`.
- `package.json` — the two packages added to `workspaces`.
- `turbo.json` — `build.outputs` now also lists `lib/**`.
- `packages/backend/package.json` / `packages/next/package.json` — dependency
  swapped to `workspace:*`.
- `packages/backend/src/routes/files/Upload.ts` — import, headers schema and
  error-message cases renamed; the dead `'Missing chibi-* headers'` case removed
  (the module throws `'Invalid headers'`, which was already handled).
- `packages/backend/src/main.ts` — CORS allowed headers renamed.
- `packages/next/src/hooks/useUploadFile.ts` — import + call renamed.
- `Dockerfile` — build both packages before the backend/frontend, and copy
  `packages/uploader-module` into the runner stage (Yarn workspaces resolve
  through a symlink, so the runtime image needs the real folder).
- Docs: `docs/architecture.md`, `docs/development.md`,
  `docs/screenshots/capture.mjs`.

## Verification

See the commit: `yarn install`, both package builds, the backend `tsc` build,
the Next.js build and a `docker build` were run on the de-forked tree, and a
repo-wide `chibi` scan only finds the intentional provenance note in
`docs/README.md` and the historical `plans/*` files.
