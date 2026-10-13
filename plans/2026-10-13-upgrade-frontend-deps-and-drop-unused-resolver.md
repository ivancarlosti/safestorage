# 2026-10-13 — Upgrade the frontend majors and drop the unused ESLint resolver

## Why

Five Dependabot PRs were open against `main` at the same time (GitHub #40–#44). Each was reviewed
against the actual usage in the tree before acting, because a few of them were not safe to merge
as-is and one was for a module the application no longer uses.

| PR | Branch | Bump | Verdict |
| --- | --- | --- | --- |
| #40 | `dependabot/npm_and_yarn/jotai-3.0.1` | `jotai` `^2.7.2 → ^3.0.1` | upgrade — used in ~47 files |
| #41 | `dependabot/npm_and_yarn/formkit/tempo-1.1.0` | `@formkit/tempo` `^0.0.19 → ^1.1.0` | upgrade — used by `lib/time.ts` |
| #42 | `dependabot/npm_and_yarn/dev-dependencies-0bc549a42c` | `eslint-import-resolver-node` `^0.3.9 → ^0.4.0` | **remove** — unused |
| #43 | `dependabot/npm_and_yarn/hookform/resolvers-5.9.1` | `@hookform/resolvers` `^3.3.4 → ^5.9.1` | upgrade — used by `SettingsForm.tsx` |
| #44 | `dependabot/npm_and_yarn/framer-motion-14.1.0` | `framer-motion` `^11.18.2 → ^14.1.0` | upgrade — used by the two dropzones |

The other distant Dependabot branches (`chokidar-5`, `shiki-4`, `tailwindcss-4`, `vaul-1.1.2`,
`dev-dependencies-06542f244d`) are the batch already merged in
`plans/2026-10-13-eslint-9-flat-config-and-tailwind-4.md`; no PRs are open for them.

## What changed

Only `packages/next/package.json` carried the four production bumps; the resolver was dropped from
the root `devDependencies`.

### `jotai` 2.7.2 → 3.0.1

v3 is "mostly backward-compatible": the public API (`atom`, `useAtom`, `useAtomValue`,
`useSetAtom`, `Provider`) is unchanged. The repo only imports those plus `atomWithImmer` from
`jotai-immer` (peer `jotai >=2.0.0`), and none of the removed utilities (`atomFamily`, `loadable`,
the `setSelf` read arg, the `delay` option, `jotai/babel`) appear anywhere, so no source change was
needed.

v3 does raise the floors: React 18 (repo has 19), TypeScript 5.5 (repo has 5.9), and **Node.js
>= 22.12.0**, and it ships ESM-only (Next.js bundles ESM). The Node floor is why every
`engines.node` in the workspace was moved from `>=22.0.0` to `>=22.12.0`, and
`docs/development.md` was updated to match.

### `@formkit/tempo` 0.0.19 → 1.1.0

Single use: `format(date, { date: 'medium', time: 'short' })` in
`packages/next/src/lib/time.ts`. The `{ date, time }` style object is the documented v1 API; the
0.x → 1.0 breaking change was only the `Z`/`ZZ` offset-token split, which this repo does not use.

### `@hookform/resolvers` 3.3.4 → 5.9.1

Single use: `zodResolver` in `packages/next/src/components/forms/SettingsForm.tsx`, still imported
from `@hookform/resolvers/zod`. v5 requires `react-hook-form ^7.55.0` (repo has `^7.90.0`) and
`zod ^3.25 || ^4.0` (repo has `^3.25.76`). `5.9.1` is intentionally the target: `5.5.6` is the
release that fixed "module not found when importing `zodResolver` under Zod v3".

### `framer-motion` 11.18.2 → 14.1.0

Used only for `AnimatePresence` and the `motion.*` component in `Dropzone.tsx` and
`AlbumDropzone.tsx` with basic `animate`/`initial`/`exit`/`transition` props. Per the Motion
upgrade guide, v12 has no React breaking changes, v13 only changes CSS-in-JS prop filtering
(Styled Components/Emotion — not used here), and v14 has no breaking changes. The `framer-motion`
package remains published alongside `motion`, so the import path was left as-is. `^14.1.0`
resolved to `14.2.0`.

### `eslint-import-resolver-node` — removed

It is only an **optional peerDependency** of `eslint-plugin-import-x`, and the hand-rolled flat
config already documents that the `import-x` rules run *without* a resolver ("the plugin runs
without a resolver (and without that dependency tree)"); the legacy `import/*` rules that would
have configured one are all disabled. The explicit root `devDependency` was a leftover from the
`eslint-config-neon` chain, so the module was deleted rather than upgraded. After `yarn install`
`node_modules/eslint-import-resolver-node` is gone and the only remaining lockfile mention is the
optional-peer declaration.

## Verification performed

| Check | Result |
| --- | --- |
| `yarn install` | pass; old versions (`jotai@2`, `framer-motion@11`, `@formkit/tempo@0`, `@hookform/resolvers@3`) and `eslint-import-resolver-node` absent from the lockfile/tree |
| Frontend `typecheck` (`tsc --noEmit`) | pass |
| Frontend `lint` (eslint) | pass, 0 errors |
| Backend `lint` (prettier + eslint) | pass, 0 errors |
| Next.js production build | pass (22/22 static pages) |
| Runtime smoke test (Node ESM) | `format('2024-01-02T03:04:05Z', { date: 'medium', time: 'short' })` → `"Jan 2, 2024, 12:04 AM"`; `jotai` `atom`/`createStore` get+set → `42`; `framer-motion` exports `AnimatePresence` (function) and `motion.div` (object) |

The only `yarn install` warning is the pre-existing `@tremor/react` peer expecting React `^18`
(unchanged by this work).

## Follow-ups (deliberately out of scope)

* `@tremor/react` still declares a React 18 peer while the repo is on React 19; it is already on
  the major-ignore list, and the render tree is unaffected.
* `jotai` 3 flips `useAtomValue` to `React.use()` internally on React 19; the app has no async
  atoms, so the "subtle mount-timing change" in the migration guide does not apply.
