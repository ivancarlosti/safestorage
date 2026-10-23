# Security dependency bumps: Next.js 15.5.28 and Fastify 5.12.6

**Status:** implemented
**Date:** 2026-10-23

## Goal

Close the three advisories `yarn npm audit` reported against the two runtime
applications of this monorepo:

| Package   | Advisory              | CVE             | Severity     | Affected             | Fixed   |
| --------- | --------------------- | --------------- | ------------ | -------------------- | ------- |
| `next`    | `GHSA-2464-fhr4-w9xw` | CVE-2026-96889  | 9.5 Critical | `>=10.0.0 <=15.5.27` | 15.5.28 |
| `next`    | `GHSA-p3m5-59mp-jv5r` | CVE-2026-94482  | 8.2 High     | `>=13.0.0 <=15.5.27` | 15.5.28 |
| `fastify` | `GHSA-389g-gv7q-r4x8` | CVE-2026-107832 | 3.7 Low      | `>=5.12.2 <5.12.6`   | 5.12.6  |

The first Next.js advisory is an unauthenticated remote code execution in the
Image Optimization API when SVG files are used: a memory-safety bug in the
upstream `sharp` used for optimization is reachable from a crafted image
request on glibc-based Linux. The second is a denial of service in App Router
applications that expose at least one Server Action — crafted requests burn CPU
and block every other request in the same process. The Fastify advisory is an
incomplete fix of CVE-2026-84428: header names inside a `propertyNames`
subschema's `enum`/`const` are not lowercased, so a header deny-list written in
canonical case never matches the lowercased request headers.

## Root cause

Both applications were pinned to vulnerable patch releases:

- `packages/next/package.json` pinned `next` exactly to `15.5.27`, which is the
  last vulnerable 15.5 release.
- `packages/backend/package.json` declared `fastify: ^5.12.5`, and
  `yarn.lock` resolved it to `5.12.5`. The caret range already admitted the
  patched `5.12.6`, but Yarn does not re-resolve an existing lockfile entry on
  its own, so nothing moved until the range or the lockfile changed.

## Changes

### `packages/next/package.json`

- `next` `15.5.27` → `15.5.28`, keeping the exact pin this workspace already
  used for Next.js. `15.5.28` is the patched backport on the 15.5 line (npm
  dist-tag `backport`); the `latest` tag is 16.x, a major upgrade that is out of
  scope here.
- No config change is needed: `15.5.28` is a patch on the same line, and its
  dependency ranges are unchanged apart from `@next/*`.

### `packages/backend/package.json`

- `fastify` `^5.12.5` → `^5.12.6`. The floor now excludes the vulnerable
  versions, so a future re-resolution (a regenerated lockfile, `yarn dedupe`)
  cannot silently land back on `5.12.5`. The caret is kept because every
  dependency in this manifest is range-based.

### `yarn.lock`

Regenerated with `yarn install`; the diff touches only the intended blocks:

- `next@npm:15.5.27` → `next@npm:15.5.28`, with `@next/env` and the nine
  `@next/swc-*` platform packages moving to `15.5.28` and new checksums.
- `fastify@npm:^5.12.5` (5.12.5) → `fastify@npm:^5.12.6` (5.12.7) with a new
  checksum. `5.12.7` is a normal 5.x patch published the same day as `5.12.6`
  and is the current `latest`, so the caret resolves one patch past the advisory
  fix. Its dependency ranges are identical to `5.12.5`.
- `next@15.5.28` declares `sharp: ^0.34.3 || ^0.35.5` (previously
  `^0.34.3 || ^0.35.4`), which encodes the advisory's workaround — "use
  `sharp >= 0.35.5`" — as a dependency floor. The resolved `sharp` stays at the
  already-installed `0.35.5`, so no extra download happens here.
- Deliberately unchanged: `postcss` (the root `resolutions` entry pins
  `8.5.30`), `styled-jsx@5.1.6`, `@swc/helpers@0.5.15`.

## Verification

1. `yarn install --immutable` — passes, so the committed lockfile is consistent
   with the manifests and the Docker build (`RUN yarn install --immutable`)
   still works. The only warning is the pre-existing `@tremor/react` peer-range
   notice about React 19, unrelated to this change.
2. Resolved versions in `node_modules`: `next 15.5.28`, `fastify 5.12.7`,
   `sharp 0.35.5`. `yarn.lock` contains exactly one `next@npm:` entry and one
   `fastify@npm:` entry, i.e. no stale duplicate versions.
3. `yarn npm audit --all --severity low` — the three advisories are gone. Only
   two deprecation notices remain, both pre-existing and out of scope:
   `eslint@9.39.5` (unsupported major line) and `fluent-ffmpeg@2.1.3` (package
   no longer supported).
4. `yarn workspace @safestorage/backend build` — clean; the Fastify bump is a
   patch release with unchanged dependency ranges and all `@fastify/*` plugins
   in use declare `fastify: ^5.0.0` as a peer, so no peer conflict.
5. `yarn workspace @safestorage/next typecheck` — clean. `next build` sets
   `typescript.ignoreBuildErrors`, so this is a separate check.
6. `yarn workspace @safestorage/next build` — clean on `15.5.28` (the build
   banner reports `Next.js 15.5.28`), including the `output: 'standalone'` tree
   the Dockerfile copies.
7. `prettier --check` on the two touched manifests and this document — clean.

## Notes / known limitations

- The image-optimization RCE was already mitigated in practice because the
  package manager provided `sharp@0.35.5`, but the Next.js bump is still
  required: it is the only fix for the Server Actions DoS, and it makes the
  `sharp` floor part of Next's own manifest instead of a coincidence of this
  lockfile.
- Staying on `15.5.28` rather than `16.4.1` (the fix line for 16.x) avoids a
  major upgrade. The 15.5 backport is supported by Vercel and clears all three
  advisories, so no migration work is needed here.
- `fastify` resolves to `5.12.7` rather than exactly `5.12.6` because the
  manifest uses a caret range. `5.12.7` contains the `5.12.6` fix; if an exact
  pin is ever required, the range must be changed to `5.12.6` and this note
  updated.
- Automated dependency tooling is not configured in this repository, so these
  bumps are manual and can drift again; the remaining audit output is a
  deprecation-only list and should not be mistaken for a clean bill of health
  for the `eslint` / `fluent-ffmpeg` replacements.
- No application code, schema, or Dockerfile change was needed; `node_modules/`
  and `packages/next/.next/` are gitignored build artifacts.
