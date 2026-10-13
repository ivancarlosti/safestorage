# ESLint flat-config migration (follow-up)

## Why
Dependabot proposed `eslint-config-neon` `^0.1.62 → ^0.5.4`. From `0.2.0`
onward the package is **flat-config only**: it no longer ships the legacy
shareable configs (`neon/common`, `neon/browser`, `neon/node`,
`neon/typescript`, `neon/prettier`, `neon/react`, `neon/next`, `neon/edge`)
and instead exports flat-config objects from subpaths such as
`eslint-config-neon/react`. It also requires ESLint 9/10 and
`typescript-eslint` 8.

Our current setup is the legacy `.eslintrc.json` chain:

- `/eslintrc.json` → `extends: ["neon/common", "neon/browser", "neon/node", "neon/typescript", "neon/prettier"]`
- `/packages/next/.eslintrc.json` → `extends: ["../../.eslintrc.json", "neon/react", "neon/next", "neon/edge", "neon/prettier"]`
- `/packages/backend/.eslintrc.json` → `extends: ["../../.eslintrc.json"]`

Applying the bump as-is breaks lint for both workspaces, so it is deferred and
explicitly ignored in `.github/dependabot.yml` until this migration lands.

## Scope
1. Bump `eslint` → `^9` (or `^10`) in `packages/next` and `packages/backend`.
2. Bump `typescript-eslint` / `@typescript-eslint/parser` → `^8`.
3. Replace the three `.eslintrc.json` files with flat config:
   - root `eslint.config.mjs` (base presets)
   - `packages/next/eslint.config.mjs`
   - `packages/backend/eslint.config.mjs`
4. Re-map the overrides currently in the root `.eslintrc.json`
   (`comma-dangle`, `id-length`, `import/*`, `@typescript-eslint/no-unsafe-*`,
   `unicorn/*`, …) onto the flat-config `rules` blocks.
5. `packages/next` runs `next lint`, which is removed in Next 16 — switch the
   frontend to a direct `eslint .` invocation at that point.
6. Bump `eslint-config-neon` → `^0.5.x` and re-enable it in `dependabot.yml`.

## Verification
- `yarn workspace @safestorage/backend lint`
- `yarn workspace @safestorage/next lint`
- Confirm the CI "🧹 Lint backend" step still passes.
