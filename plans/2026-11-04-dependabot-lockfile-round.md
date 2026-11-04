# Plan - Dependabot round: seroval, systeminformation, glob (and the minimatch blocker)

> Task: close four of the five open Dependabot alerts on the `yarn.lock` manifest
> and document why the fifth cannot be closed without breaking the lint stack.

## 1. Context

Five alerts were open against `yarn.lock` on 2026-11-04:

| # | Package | Severity | Advisory | Vulnerable | Patched | Resolved now |
|---|---|---|---|---|---|---|
| 238 | `systeminformation` | **high** | GHSA-3f7j-7jwc-fxfj - Windows command injection in `services()` | `< 5.33.16` | 5.33.16 | 5.33.15 -> **5.33.16** |
| 237 | `seroval` | medium | GHSA-f86p-h4j2-7qgj - code injection through a typed array constructor | `>= 1.6.0, < 1.6.11` | 1.6.11 | 1.6.9 -> **1.6.11** |
| 236 | `seroval` | medium | GHSA-9wx9-5pv9-3349 - script injection through RegExp sources | `>= 1.5.5, < 1.6.10` | 1.6.10 | 1.6.9 -> **1.6.11** |
| 239 | `glob` | medium | GHSA-3g3m-2fjr-6pw4 - AbortSignal cancellation bypass | `>= 9.0.0, <= 14.0.1` | 14.0.2 | 13.0.6 / 10.5.0 -> **14.0.3** |
| 240 | `minimatch` | medium | GHSA-g3hv-75wg-m249 - ReDoS via globparts amplification | `< 11.0.1` | 11.0.1 | **blocked**, see §4 |

`seroval` is a `solid-js`/`@tanstack` serialiser reachable from the Next
workspace; `systeminformation` is a direct dependency of
`packages/backend` (hardware metrics); `glob` is pulled by
`@fastify/static` (serves the built frontend at runtime), `cacache` and `rimraf`.

## 2. Goal

- The four closable alerts close as `fixed` on the next Dependabot run, with the
  lockfile still installing, linting and building.
- The `minimatch` alert gets an explicit, written decision rather than a silent
  stay-open.

## 3. Steps

1. `packages/backend/package.json`: `systeminformation` `^5.33.15` -> `^5.33.16`.
2. Root `package.json` `resolutions` block (the way this monorepo pins
   transitive versions):
   - `"seroval": "1.6.11"`
   - `"systeminformation": "5.33.16"`
   - `"glob": "14.0.3"` - replaces the four `glob@10.x -> 10.5.0` pins, which
     were themselves vulnerable: the whole graph moves to one modern `glob`.
3. `yarn install` (Yarn 4.1.1, `nodeLinker: node-modules`) regenerates
   `yarn.lock`.
4. Validation: `yarn lint` (turbo, 4 packages, includes Prettier and ESLint with
   the `import-x`, `n`, `unicorn`, `react` plugins) and `yarn build`.
5. Compatibility check of the major bump against the packages that consume it:
   `@fastify/static` (`const { glob } = require('glob')`) and `rimraf`
   (`import { glob, globSync } from 'glob'`) - both names are still exported by
   `glob@14.0.3`, and `glob@14` requires Node `18 || 20 || >=22`, which matches
   `engines.node >= 22.19.0`.

## 4. Decision: `minimatch` stays at 3.1.5 / 5.1.9 / 10.2.6

Forcing `minimatch` to 11.0.4 (the only patched line) **breaks the toolchain that
this repository lints itself with**, so the resolution was applied, measured and
reverted:

```
eslint-plugin-import-x/lib/rules/no-internal-modules.js:1
import { makeRe } from 'minimatch';
SyntaxError: The requested module 'minimatch' does not provide an export named 'makeRe'
```

What `minimatch@11` removes is exactly what the ESLint 9 stack uses:

| Consumer | Declaration | Uses | Works on 11? |
|---|---|---|---|
| `@eslint/config-array` 0.21.2 | `^3.1.5` | `import minimatch from 'minimatch'` (default export = the function) | no - no default export |
| `@eslint/eslintrc` 3.3.6 | `^3.1.5` | `require('minimatch')` then call it | no |
| `eslint-plugin-react` 7.37.5 | `^3.1.2` | `const minimatch = require('minimatch')` | no |
| `eslint-plugin-import-x` 4.17.1 (latest) | `^9.0.3 \|\| ^10.1.2` | `makeRe`, `Minimatch` | no - `makeRe` removed |
| `fs-jetpack` 5.1.0 | `^5.1.0` | v5 API | no |
| `@typescript-eslint/typescript-estree` 8.71.2 | `^10.2.2` | `Minimatch` | yes |

There is no newer `eslint-plugin-import-x` (4.17.1 is `latest`) and no patched
release inside the v3/v5/v10 lines (3.1.5, 5.1.9 and 10.2.6 are the newest of
their lines), so the upgrade path does not exist today.

Risk assessment of leaving it: the advisory is a **ReDoS**
(`GHSA-g3hv-75wg-m249`, medium) reachable only while matching a pattern against
attacker-supplied *path segments* - the vulnerable instances are all in the lint
toolchain (`@eslint/*`, `eslint-plugin-react`, `eslint-plugin-import-x`,
`fs-jetpack`, `@typescript-eslint/typescript-estree`), which runs on the
repository's own files, never on user input of the shipped app. The runtime
`minimatch` that comes with `glob@14.0.3` is **11.0.4**, i.e. the patched line.

Follow-up: revisit when ESLint 10 (or a `@eslint/eslintrc` release that adopts
`minimatch >= 11`) lands; the alert can then be closed by a normal bump.

## 5. Risks

- **`glob` major bump (13 -> 14 and 10 -> 14).** `cacache` declared `^10.2.2`,
  `@fastify/static` `^13.0.0`, `rimraf` `^13.0.3` - the resolution overrides the
  declared ranges. Both APIs used here (`glob`, `globSync`) are unchanged, and
  lint/build are green; a docker-compose smoke test of the upload + static
  serving path is the remaining check.
- **`seroval`/`systeminformation`** are patch/minor bumps inside their lines, no
  API change.
- The `resolutions` block is the documented mechanism of this repo, so the pins
  are visible in review instead of being buried in `yarn.lock`.

## 6. Verification

```bash
node .yarn/releases/yarn-4.1.1.cjs install          # EXIT=0
node .yarn/releases/yarn-4.1.1.cjs lint             # EXIT=0, 4 packages
node .yarn/releases/yarn-4.1.1.cjs build            # EXIT=0
grep -n '^"glob@\|^"minimatch@\|^"seroval@\|^"systeminformation@' yarn.lock
```

After the push: `gh api repos/ivancarlosti/safestorage/dependabot/alerts`
should show 238/239/236/237 `fixed` and only 240 (minimatch) still open.
