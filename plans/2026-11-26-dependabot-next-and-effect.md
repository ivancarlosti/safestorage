# Dependabot: next 15.5.29 and the effect ReDoS override

## Context

After rolling `main` back to the `v8.0.3` content, two dependency issues were still
open on the default branch:

- **PR #49** (`dependabot/npm_and_yarn/npm_and_yarn-0981f8b48c`) bumped `next` from
  `15.5.28` to `15.5.29`, closing three moderate advisories:
  `GHSA-pc58-hwjq-p385` (cross-client response injection), `GHSA-7qx7-33qx-rqx2`
  (SVG rejection bypass in image optimization) and `GHSA-f3mh-rxg3-f5g2`
  (HttpOnly cookie exposure on Edge runtime routes).
- **Alert #242** (`GHSA-7589-6fvf-x4pw`, **high**): `effect <= 3.22.0` has a ReDoS in
  `Schema.TemplateLiteral`. `effect@3.20.0` is a transitive pin of
  `@prisma/config@7.10.1`; even the latest published `@prisma/config` still pins
  `3.20.0`, so a Prisma bump cannot fix it. The project already resolves
  transitive pins this way (`deepmerge-ts`, `seroval`, `minimatch`, …).

## Goal

Close every open Dependabot alert and publish a new patch release built from the
reverted (`v8.0.3`) tree, so `latest` images match the code on `main`.

## Steps

1. Merge PR #49 with a merge commit (the repository style), keeping the same PR
   instead of recreating the bump.
2. Add the patched `effect` to the root `resolutions` block:

   ```json
   "resolutions": {
     "deepmerge-ts": "8.0.2",
     "effect": "3.22.5",
   ```

   `3.22.5` is the newest `3.x` release; the advisory is fixed from `3.22.1`, and
   staying on `3.x` keeps the API `@prisma/config` expects (`effect@4` is a
   different major line).
3. `yarn install` to rewrite `yarn.lock` (`effect@npm:3.22.5`), then verify the
   Prisma CLI still loads its config through `effect`:
   `prisma migrate status --config packages/backend/prisma.config.ts`.
4. Run the full suite before pushing: backend tests/lint/build, Next lint,
   `tsc --noEmit` and a production `next build` with `15.5.29`.
5. Commit as `fix(deps): …` (a releasable type) and push. The automatic
   semantic-release run then cuts `v8.2.1`, creates the GitHub Release and
   dispatches `build.yml` for the new images.

## Risks

- **`effect` minor bump inside Prisma's config loader.** `3.20.0 → 3.22.5` crosses
  two minors. Validated by loading `prisma.config.ts` (which imports
  `effect` via `@prisma/config`) and running `migrate status`; a runtime failure
  would show up there or in the backend boot.
- **`next` patch release.** `15.5.29` is a security patch of the same minor. A
  clean production build and the CI image build are the guardrails.
- **Release contents.** The release commit tree is the reverted `v8.0.3` code plus
  the two dependency fixes, so `latest` stops shipping the reverted album website
  feature.
- **Version history.** `v8.1.0`, `v8.1.1` and `v8.2.0` remain published; the new
  `v8.2.1` is the first release without the feature.

## Verification (2026-11-27)

- PR #49 merged as `62ab7d8` with a merge commit; the same Dependabot PR was used,
  no replacement PR was opened.
- `effect` overridden in `resolutions` to `3.22.5`, `yarn.lock` rewritten. The Prisma CLI
  loads `prisma.config.ts` (which reaches `effect` through `@prisma/config`) and
  `migrate status` runs normally against the local MariaDB, so the minor bump is safe
  for the config loader.
- Local suite on the final tree: backend test/lint/build, Next lint, `tsc --noEmit` and a
  production `next build` with `next@15.5.29` all exit 0.
- `da74080` (`fix(deps): …`) triggered semantic-release → release **v8.2.1**
  (published, not a draft), which dispatched `🐳 Build Artifacts` run `45914963866`
  (success, 18m32s).
- `ghcr.io/ivancarlosti/safestorage:8.2.1` and `:latest` resolve to the same multi-arch
  index `sha256:00a21f3b…` (linux/amd64 + linux/arm64). Build provenance records
  `COMMIT=da7408010603d5bb6d70e30e255a2eec98d6c157`, `VERSION=8.2.1`, so `latest` now
  ships the rolled-back tree plus both dependency fixes.
- Release assets: `safestorage-8.2.1.zip`.
- Post-push state: 0 open Dependabot alerts (was 1 high + 6 moderate), 0 open
  code-scanning alerts, no open Dependabot PRs, CodeQL and semantic-release runs green.

