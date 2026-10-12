# De-fork: SafeStorage, a chibisafe v7 copy

**Status:** done
**Date:** 2026-10-12

## Goal

Take the chibisafe v7 source tree, keep the application logic, and re-brand /
re-home it as `ivancarlosti/safestorage` so the project can evolve on its own
(notably: fix uploads above 2 GB) without carrying upstream branding, URLs,
authors or community links.

## Background

`chibisafe` v7 is a Turborepo/yarn-4 workspaces monorepo:

-   `packages/backend` – Fastify + Prisma API (`:8000`), owns uploads, thumbnails, DB.
-   `packages/next` – Next.js 14 frontend (`:8001`), `output: 'standalone'`.
-   `packages/migration` – v4 → v5 data migration helper.
-   Upstream ships the frontend, the backend and Caddy as **three** containers.

## What was done

1. Copied the source into this repository, excluding upstream-only artefacts:
   `.git`, `.github`, `Caddyfile`, `docker/`, `docker-compose*.yml`, `minio/`,
   `LICENSE`, `README.md`, docs website assets.
2. Re-branded identifiers:
    - `@chibisafe/backend` → `@safestorage/backend`,
      `@chibisafe/next` → `@safestorage/next`,
      `@chibisafe/migration` → `@safestorage/migration`.
    - Root workspace package `chibisafe@workspace:.` → `safestorage@workspace:.`
      (including the `yarn.lock` keys).
    - All source strings `Chibisafe`/`chibisafe` → `SafeStorage`/`safestorage`.
3. Re-homed URLs and metadata:
    - GitHub/website links → `https://github.com/ivancarlosti/safestorage`.
    - `UpdateCheck.ts` GitHub releases API + guard for repos with no releases.
    - Footer author → Ivan Carlos; Discord/Patreon links removed from the header.
    - `layout.tsx` `authors`/`creator`, FAQ content, `Docs.ts`, `.gitignore`.
    - `ChibisafeLogo.tsx` → `SafeStorageLogo.tsx` (same component, new export/name).
4. Kept third-party package names that we do **not** own
   (`@chibisafe/uploader-module`, `@chibisafe/uploader-client` from npm) so the
   upload pipeline keeps working; they are wrapped behind our own code paths.

## Verification

-   `grep -rIn -iE 'chibisafe|weeb\.sh|pitu\.tf|chibi\.'` over the tree (excluding
    `node_modules`, `.git`, `.yarn`, build output and `yarn.lock`) returns no hits
    in shipped source or metadata: only the third-party dependency names
    `@chibisafe/uploader-module` / `@chibisafe/uploader-client` and one comment
    referencing those headers remain. `git ls-files | grep -i chibi` is empty, so
    no file is named after upstream either.
-   `yarn install --immutable` succeeds against the re-keyed `yarn.lock`.
-   Backend `tsc` build (inside `docker build`) and the Next production build both
    succeed, and the combined image boots into a `healthy` container.

## Notes / limitations

-   The npm packages `@chibisafe/uploader-*` remain a third-party dependency; see
    `2026-10-12-upload-over-2gb.md` for how we work around their limits without
    forking them.
-   `.github/workflows/` keeps its original contract (it builds `Dockerfile` from
    git and publishes to `ghcr.io/<owner>/safestorage`); it is intentionally not
    edited.
