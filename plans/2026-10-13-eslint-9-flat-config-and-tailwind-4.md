# 2026-10-13 — ESLint 9 flat config, Tailwind CSS v4, and the end of `braces`

## Why

Five Dependabot PRs were open against `main` at the same time:

| PR | Bump |
| --- | --- |
| 1 | `chokidar` `^3.6.0 -> ^5.0.0` |
| 2 | `shiki` `^1.3.0 -> ^4.5.0` |
| 3 | `tailwindcss` `^3.4.3 -> ^4.3.3` |
| 4 | `vaul` `^0.9.0 -> ^1.1.2` |
| 5 | `@typescript-eslint/parser` `^7.5.0 -> ^7.18.0` |

PR 5 is subsumed by `typescript-eslint` 8. PRs 1 and 3 are also the last two *toolchain* paths
that pulled `braces` into the tree, which the repo currently mitigates with a local Yarn patch
(`plans/2026-10-13-braces-stack-overflow-and-log-redaction.md`). After PR 5, `braces` had exactly
four parents left:

* `chokidar@3` (runtime, `packages/backend/src/utils/Watcher.ts`) -> removed by PR 1;
* `fast-glob` via `tailwindcss@3` -> removed by PR 3;
* `fast-glob`/`globby` via `@typescript-eslint/typescript-estree` (pulled in by
  `eslint-config-neon`) -> removed by moving to `typescript-eslint` 8;
* `@next/eslint-plugin-next@16 -> fast-glob@3.3.1`, which `next lint` loads -> removed by dropping
  the Next.js ESLint plugin.

So all five bumps plus the two migrations were done as one change, and the `braces` patch and
`resolutions` entries were deleted at the end.

## What changed

| Area | Before | After |
| --- | --- | --- |
| Backend path aliases | `tsc-alias` (build) + `tsconfig-paths/register` (runtime) | `packages/backend/scripts/rewrite-path-aliases.mjs`, zero deps |
| Lint | `eslint-config-neon` (`.eslintrc.json` chain) + `next lint` | hand-rolled flat config: root `eslint.config.mjs` + one per workspace |
| Styling | `tailwindcss` 3 + `tailwind.config.js` + PostCSS + autoprefixer | `tailwindcss` 4 + `@tailwindcss/postcss`, CSS entry in `src/styles/globals.css`, theme still read through `@config` |
| `braces` | local Yarn patch + 2 `resolutions` | not in the tree at all |

## 1. Dependency bumps

Runtime/tooling versions were taken as published: `chokidar` 5.0.0, `shiki` 4.5.0, `vaul` 1.1.2,
`tailwindcss` + `@tailwindcss/postcss` 4.3.3, `tw-animate-css` 1.4.0.

* **shiki 4** removed the deprecated `getHighlighter()` alias: the backend route
  (`src/routes/files/HighlightFile.ts`) and the frontend helper (`src/lib/shiki.ts`) now call
  `createHighlighter()`, and the backend imports the root `shiki` entry instead of
  `shiki/bundle/full` (both bundle every language and theme). Verified at runtime: 242 bundled
  languages, alias lookup `rs -> rust`, `codeToHtml` output unchanged, and the Next.js production
  build compiles with it.
* **chokidar 5** is ESM-only (backend is ESM, `engines: >=22`) and `Watcher.ts` needed no change:
  `alwaysStat`, `ignoreInitial` and the `(path, stats)` event signature are all still there.
* **vaul 1.1.2** is used by the `drawer` primitive only; the frontend typechecks and builds.
* **`tw-animate-css`** replaces `tailwindcss-animate` (the v4-recommended drop-in), and
  `@tailwindcss/container-queries` is gone because v4 has native container queries - the repo never
  used the plugin's `@container` classes anyway.

## 2. Backend: build-time alias rewriting replaces `tsc-alias` + `tsconfig-paths`

`build` is now `rimraf dist && tsc && node scripts/rewrite-path-aliases.mjs`, and `start` no longer
loads `-r tsconfig-paths/register`.

The rewriter walks `dist/**`, finds the alias specifiers that `tsc` copies verbatim
(`from '@/x.js'`, `import '@/x.js'`, `import('@/x.js')`, `require('@/x.js')`), resolves them against
the emitted tree and rewrites them to relative paths; an alias that does not resolve to an emitted
file fails the build. Measured on the real tree: **483 rewrites in 104 files**, identical to the
`tsc`-only output (`152` `.js` files in both), `0` alias specifiers left in `dist`, and every
emitted `.js` passes `node --check`.

The `-r tsconfig-paths/register` preload was provably inert for this package, so removing it cannot
change behaviour:

```
# CJS: the preload resolves the alias
$ node -r <register> -e "console.log(require.resolve('@/../package.json'))"
/home/ivan/Documents/Git/safestorage/packages/backend/package.json

# ESM: the same preload is ignored by the ESM loader
$ node -r <register> --input-type=module -e "await import('@/../package.json', ...)"
ESM -> ERR_MODULE_NOT_FOUND
```

`tsconfig-paths` hooks the CommonJS `Module._resolveFilename`; static ESM `import`s never consult
it. Left to itself, `tsc` output therefore fails at `node dist/main.js` with
`ERR_MODULE_NOT_FOUND: Cannot find package '@/…'` (483 occurrences survived a plain `tsc` run),
which is what the new build step fixes.

## 3. ESLint 9 flat config (`eslint-config-neon` -> hand-rolled)

`eslint.config.mjs` in the root is the shared base and is imported by
`packages/backend/eslint.config.mjs` and `packages/next/eslint.config.mjs`; the three
`.eslintrc.json` files and `packages/next/.eslintignore` are deleted. `next lint` is replaced by
`eslint src`, type-aware rules run through `parserOptions.projectService: true`, and each workspace
sets `tsconfigRootDir` to its own directory. Plugins: `@eslint/js`, `typescript-eslint` 8,
`eslint-plugin-{react,react-hooks,unicorn,promise,n,import-x}`, `globals` and
`eslint-config-prettier` last.

### The rule set was derived from the legacy config, not guessed

Before writing any rules the *resolved* legacy configuration was dumped with ESLint 8 in a scratch
directory (`eslint --print-config` on a dummy file using the real `extends` chain and overrides):
**413 rules for the backend, 481 for the frontend**. The first flat-config draft produced 605
backend findings, almost all from rules that preset had explicitly disabled
(`unicorn/prevent-abbreviations` 269, `unicorn/filename-case` 121,
`@typescript-eslint/no-explicit-any` 36, `unicorn/no-null` 35, `no-await-in-loop` 34, ...).

The final config keeps the modern recommended sets and then turns off - each with a comment -
everything the legacy preset had off *and* the current code does not satisfy: core
(`no-await-in-loop`, `no-bitwise`, `no-mixed-operators`), type-aware (`no-explicit-any`,
`no-unused-vars`, `no-wrapper-object-types`, `no-unnecessary-type-assertion`,
`restrict-template-expressions`, `require-await`, `no-redundant-type-constituents`,
`unbound-method`), `n/*` (`no-missing-import`, which flags all 753 `@/` alias imports,
`no-unpublished-import`, `no-process-exit`, `no-unsupported-features/node-builtins`),
`promise/always-return` and 20 `unicorn/*` rules. Where a rule stayed enabled it was kept at the
*legacy options* instead of the newer defaults: `ban-ts-comment` (`ts-ignore: false`),
`no-misused-promises` (`checksVoidReturn: false`), `no-floating-promises`
(`ignoreIIFE: true, ignoreVoid: true`, which is what the two findings needed), `no-sync`
(`allowAtRootLevel: true`), `no-param-reassign` (`props: false`) and `no-empty-object-type`
(`allowInterfaces: 'with-single-extends'`).

### Deliberate deltas

* **Not carried over:** the `jsdoc` plugin (49 legacy rules), `jsx-a11y` (the legacy frontend
  extended `neon/react`/`neon/next`/`neon/edge`, never `neon/jsx-a11y`, so it had **0** rules), the
  `@next/next/*` rules, and most `import/*` rules - only seven syntactic ones are enabled
  (`order`, `first`, `no-duplicates`, `no-absolute-path`, `no-useless-path-segments`,
  `no-self-import`, `no-mutable-exports`). That is why `eslint-plugin-import-x` needs no TypeScript
  resolver: `no-unresolved`, `no-cycle`, `named`, `default` and `no-extraneous-dependencies` were
  all off in the legacy config.
* **`import-x/order`** runs on the backend with the legacy options plus an explicit `pathGroups`
  mapping (`@/**`/`~/**` -> `internal`): import-x cannot classify a specifier it cannot resolve on
  disk, and without the mapping it demands that relative imports precede the aliases. The frontend
  keeps `order` off, because it sorts imports with `@ianvs/prettier-plugin-sort-imports`.
* **`eslint-plugin-unicorn` is held at 65.x:** 66.0.0+ declares `eslint >= 10.4` as a peer, and the
  repo deliberately stays on the ESLint 9 line (`typescript-eslint` 8 accepts both, but the rest of
  the plugin set is still 9-era). The major is ignored in `dependabot.yml` with that reason.
* **`react/no-unused-prop-types` is enabled explicitly:** eslint-plugin-react 7.37 dropped it from
  its `recommended` set, but the legacy preset enforced it and it caught a real dead prop.
* **react-hooks** gets exactly the two legacy rules (`rules-of-hooks`, `exhaustive-deps`).
  eslint-plugin-react-hooks 7 only ships eslintrc-shaped configs (a `plugins` *array*), and its 14
  new React Compiler rules (`purity`, `immutability`, `set-state-in-effect`, ...) need their own
  adoption pass.
* **`react/prop-types` stays enabled** (it is part of eslint-plugin-react's `recommended`). Of the
  21 file-level `/* eslint-disable react/prop-types */` comments under `components/ui/`, 20 turned
  out to be dead and went away with the sweep; one is still needed.
* **`reportUnusedDisableDirectives: 'error'`** makes dead suppressions fail instead of hiding. The
  sweep (`eslint src --fix --fix-type directive`) removed 10 dead backend directives and 22 frontend
  ones (19 of them `react/prop-types`); the 5 `@next/next/no-img-element` directives had to be
  deleted by hand, because ESLint cannot auto-remove a directive whose rule is not defined. In-repo
  suppressions went from 71 to 36.

### Real issues the new config surfaced

* `react/jsx-key`: `SnippetViewer` inside a `.map()` had no `key` -> added.
* `react/jsx-no-target-blank`: `AlbumLinksTable` opened `target="_blank"` without `rel` -> added
  `rel="noopener noreferrer"`.
* `no-constant-binary-expression`: `packages/backend/src/structures/settings.ts` carried a dead
  `?? 8000` (removed), and `src/utils/User.ts` has `Number(…) + extraBytes ?? 0` where `+` binds
  tighter than `??` so the fallback can never apply. That one is a behaviour question, so the
  expression is left as-is and suppressed with an explanatory comment.
* `no-empty-object-type`: three `PropsWithChildren<{}>` became `PropsWithChildren`.
* `react/no-unused-prop-types`: the dead `total` prop of `FilesWrapper` (declared, never read) was
  removed together with its six call sites.

## 4. Tailwind CSS v4

`postcss.config.js` now loads only `@tailwindcss/postcss` (v4 bundles autoprefixer, so the
`autoprefixer` dependency is gone). `src/styles/globals.css` starts with `@import 'tailwindcss'` +
`@import 'tw-animate-css'` and declares the parts v4 will not read from a JavaScript config:

```css
@config '../../tailwind.config.js';
@custom-variant dark (&:where(.dark, .dark *));
@source '../../../../node_modules/@tremor/**/*.{ts,tsx,js,jsx}';
@source inline("{bg,text,border,ring,stroke,fill}-{slate,…,rose}-{50,…,950}");
@source inline("hover:{bg,text,border}-{slate,…,rose}-{50,…,950}");
@utility container { width: 100%; margin-inline: auto; padding-inline: 2rem; @media (min-width: 1400px) { max-width: 1400px } }
```

`@config` is resolved relative to the CSS file, and `theme.container` was dropped by v4 - it is
recreated as the `@utility` above (the legacy config centred it, added 2rem inline padding and
capped it at 1400px).

### Why `@config` instead of moving the theme into CSS

The theme is not shadcn-shaped: `tailwind.config.js` defines ~90 Tremor tokens (colours, shadows,
font sizes, radii) plus `fontFamily` and the accordion keyframes, and it **overrides** the default
`borderRadius.sm/md/lg` scale. `@config` is the documented v4 compatibility path and keeps every
token value byte-identical, while `@utility container` replaces the dropped `theme.container` and
`@source inline()` replaces the unsupported v4 `safelist`. Converting the theme by hand (or with
`@tailwindcss/upgrade`) would have re-derived scale names - `rounded-sm` here resolves to
`calc(var(--radius) - 4px)`, not v4's default `0.25rem` - which is exactly the kind of silent
visual change a dependency bump must not introduce.

### Renames applied (v4 renamed/deprecated utilities)

| Legacy | v4 | Sites |
| --- | --- | --- |
| `outline-none` | `outline-hidden` | 23 |
| `shadow-sm` | `shadow-xs` | 3 |
| `blur-sm` / `blur` / `blur-0` | `blur-xs` / `blur-sm` / `blur-none` | 1 + 1 |
| `rounded` (bare) | `rounded-sm` (both `4px` here) | 2 |
| `bg-gradient-to-*` | `bg-linear-to-*` | 3 |
| `bg-opacity-10` / `bg-opacity-40` | `bg-slate-300/10` / `bg-white/40` | 3 |

`rounded-sm` itself is *not* renamed (see the theme override above), and the rules file
(`tailwind.config.js`) keeps its `content` globs; `darkMode`, `theme.container`, `safelist` and
`plugins` are removed because v4 ignores or replaces them. `ui-selected:*` from the legacy safelist
is dropped: the variant was never registered, so no CSS was ever generated for it.

## 5. `braces` removal

`package.json` loses its two `braces` `resolutions` and
`.yarn/patches/braces-npm-3.0.3-582c14023c.patch` is deleted. After `yarn install`:

```
$ yarn why braces      # (no output)
$ yarn why fast-glob   # (no output)
$ yarn why globby      # (no output)
$ ls node_modules/braces
ls: cannot access 'node_modules/braces': No such file or directory
$ grep -c 'braces@' yarn.lock ; grep -c 'braces-npm' yarn.lock
0
0
```

`yarn why` prints nothing for a package that is not in the tree (checked with a control probe for a
non-existent package name), and `micromatch` is gone as well.

## 6. Verification performed

| Check | Result |
| --- | --- |
| `yarn install` | pass; no `braces`/`fast-glob`/`globby`/`micromatch` in the tree or lockfile |
| Backend `generate` + `build` | pass; 483 aliases rewritten in 104 files |
| `dist` alias scan + `node --check` on every emitted `.js` | 0 alias specifiers, all files parse |
| Backend `lint` (prettier + eslint; 131 files) | **0 errors, 0 warnings** |
| Frontend `lint` (eslint; 197 files) | **0 errors, 0 warnings** |
| Frontend `typecheck` (`tsc --noEmit`) | pass |
| Frontend `format:check` | "All matched files use Prettier code style!" |
| Next.js production build | pass (22/22 static pages) |
| Emitted CSS assertions | `.outline-hidden`, the 22×11 safelisted `bg/text/border/ring/stroke/fill` families (242 rules each), 726 `hover:` rules, `.dark` variant, `.container` with `max-width: 1400px`, `tremor` tokens, `animate-in`; no `--tw-bg-opacity`, no `outline-none`/`bg-gradient-to-`/`bg-opacity-` |
| Backend runtime boot | `node dist/main.js` against a throwaway database + `GET /api/health` |

## Follow-ups (deliberately out of scope)

* `packages/next` still has no `jsx-a11y` rules - it never had any. Adding the plugin and fixing
  its findings is a separate accessibility pass.
* `@typescript-eslint/no-unsafe-*`, `no-explicit-any`, `no-unused-vars` and 20 `unicorn/*` rules
  stay off exactly as they were under neon; the config documents each one where it is switched off.
* `eslint-plugin-unicorn` 66+ and ESLint 10 are blocked on each other; `dependabot.yml` ignores both
  majors.
* The React Compiler rule set shipped with `eslint-plugin-react-hooks` 7 is not enabled yet.
* `no-constant-binary-expression` in `src/utils/User.ts` marks a genuinely dead fallback in the
  storage-quota maths; fixing it changes reported usage, so it needs its own decision.


