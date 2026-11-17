# Plan - Close the minimatch advisory (GHSA-g3hv-75wg-m249 / CVE-2026-118764)

## 1. Context

Dependabot alert **#241** (manifest `yarn.lock`, scope `development`, relationship
`transitive`) reports `minimatch@10.2.6`:

| Field | Value |
|---|---|
| Advisory | GHSA-g3hv-75wg-m249 / CVE-2026-118764 |
| Summary | Potential denial of service via globparts amplification (`firstPhasePreProcess()`) |
| Severity | medium (CVSS 4.0: 6.9) |
| Vulnerable range | `>= 7.0.0, < 11.0.1` |
| First patched | **11.0.1** |

`minimatch@10.2.6` entered the graph twice, both from the lint stack:

| Consumer | Previous version | Declared range |
|---|---|---|
| `@typescript-eslint/typescript-estree` | 8.71.2 (via `typescript-eslint@8.71.2`) | `^10.2.2` |
| `eslint-plugin-import-x` | 4.17.1 | `^9.0.3 \|\| ^10.1.2` |

`plans/2026-11-04-dependabot-lockfile-round.md` (§4) recorded this alert as
**blocked**: forcing `minimatch@11` broke both consumers (`makeRe` and the
default export were removed in v11) and neither dependency had a release that
accepted `minimatch 11`. That has changed:

- `eslint-plugin-import-x@4.18.1` now declares
  `minimatch: ^9.0.3 || ^10.1.2 || ^11.0.1`.
- `typescript-eslint@8.73.0` ships `@typescript-eslint/typescript-estree@8.73.0`,
  which declares `minimatch: ^11.0.1`.

The remaining `minimatch@3.1.5` (`@eslint/config-array`, `@eslint/eslintrc`,
`eslint-plugin-react`, `eslint`) and `minimatch@5.1.9` (`fs-jetpack`, pulled by
`packages/uploader-module`) are **outside** the vulnerable range (`>= 7.0.0`) and
depend on the v3/v5 CommonJS API, so they are intentionally left untouched.

## 2. Goal

- No `minimatch` version in the `>= 7.0.0, < 11.0.1` range anywhere in
  `yarn.lock`; the toolchain resolves the patched line (`11.0.1` or newer).
- Alert #241 closes as `fixed` without a forced `resolutions` override.
- `yarn lint`, `yarn build` and `yarn test` stay green.

## 3. Steps

1. Root `package.json` `devDependencies`:
   - `eslint-plugin-import-x`: `^4.17.1` -> `^4.18.1`.
   - `typescript-eslint`: `^8.71.2` -> `^8.73.0` (also bumps the
     `@typescript-eslint/*` packages from 8.71.2 to 8.73.0).
2. `yarn install` (Yarn 4.1.1, `nodeLinker: node-modules`) regenerates
   `yarn.lock`. Both consumers now resolve `minimatch@11.0.9`.
3. `yarn dedupe minimatch` folds the pre-existing `glob@14.0.3` pin
   (`^11.0.2` -> `11.0.4`) into the same `11.0.9` entry, so the lockfile keeps a
   single patched v11 copy.
4. No `resolutions` entry is added: the patched version is inside every
   declared range, so the lockfile stays honest about what the graph requests.
5. Validation: `yarn install --immutable`, `yarn lint` (4 packages),
   `yarn build`, `yarn test`, then confirm the lockfile contents with
   `grep '^"minimatch@' yarn.lock`.

## 4. Risks

- **`typescript-eslint` 8.71.2 -> 8.73.0** is a minor bump inside v8; the flat
  config only consumes `tseslint.configs.recommended*`, which is unchanged.
  `eslint-plugin-import-x` 4.17.1 -> 4.18.1 is a minor bump; the rules in use
  (`first`, `no-absolute-path`, `no-duplicates`, `no-mutable-exports`,
  `no-self-import`, `no-useless-path-segments`, `order`) are stable.
- **`minimatch@11` API surface**: the consumers that broke in the last attempt
  are the ones being upgraded here, and both now declare explicit support for
  `^11.0.1`. The v3/v5 consumers (`@eslint/*`, `eslint-plugin-react`,
  `fs-jetpack`) keep their own copies, so they are unaffected.
- **Node engines**: `minimatch@11` requires Node `20 || >=22`; the repo pins
  `>=22.19.0` (`.nvmrc` 22.23.3), so no change is needed.
- **Dedupe**: lifting `glob`'s `minimatch` from 11.0.4 to 11.0.9 stays inside
  the declared `^11.0.2` range and inside the patched line.

## 5. Verification

```bash
node .yarn/releases/yarn-4.1.1.cjs install --immutable   # EXIT=0
node .yarn/releases/yarn-4.1.1.cjs lint                  # EXIT=0, 4 packages
node .yarn/releases/yarn-4.1.1.cjs build                 # EXIT=0
node .yarn/releases/yarn-4.1.1.cjs test                  # EXIT=0
grep -n '^"minimatch@' yarn.lock                         # only 11.0.9, 3.1.5, 5.1.9
```

After the push, `gh api repos/ivancarlosti/safestorage/dependabot/alerts`
should report alert 241 as `fixed` on the next Dependabot run.
