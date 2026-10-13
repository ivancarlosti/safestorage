# 2026-10-13 - `braces` stack-overflow (CVE-2026-93687) and sensitive-data-in-logs hardening

## Context

Two vulnerabilities were reported against the monorepo:

1. **Stack-overflow DoS in `braces@3.0.3`** (CWE-674, CVSS 8.7). `braces` is pulled in
   transitively by `chokidar@3.6.0` (runtime file watcher, `packages/backend/src/utils/Watcher.ts`)
   and by `micromatch@4.0.8` (build tooling only).
2. **Potential logging of sensitive data** across the backend, the Next.js frontend and the
   two uploader packages.

## 1. `braces` stack overflow - CVE-2026-93687

### Why a local patch is required

`npm view braces versions` shows **3.0.3 is the latest published release**; the advisory lists
**no patched version** and there is nothing newer to upgrade to. A local Yarn patch (the
mechanism the repo already uses for transitive pins via `resolutions`) is therefore the only
non-invasive option.

### Root cause

`lib/parse.js` bounds the pattern by **character count** (`MAX_LENGTH = 10000`) but never by
**nesting depth**. Every downstream stage is a naive recursive AST walker
(`compile.js#walk`, `stringify.js#walk`, `expand.js#expand`/`append`, `utils.js#flatten`), so
each nesting level costs one JS stack frame. Measured reachable AST depth inside the
character cap:

| Pattern | Nesting reached | Result |
| --- | --- | --- |
| `'{a,'.repeat(2499) + 'a' + '}'.repeat(2499)` | 2500 | uncontrolled deep recursion |
| `'('.repeat(4999) + 'a' + ')'.repeat(4999)` | 4999 | uncontrolled deep recursion |

The character cap does **not** bound recursion.

### Fix (mirrors the advisory recommendation)

The advisory recommends enforcing a maximum nesting depth in `parse()` so that every
downstream walker is bounded at the source. The patch:

* adds `MAX_DEPTH: 100` to `lib/constants.js`;
* adds a `nesting` counter in `lib/parse.js`, incremented on `(` / `{` and decremented on the
  matching close, throwing
  `SyntaxError("Input nesting depth (N) exceeds max depth (100)")` when exceeded;
* honours an `options.maxDepth` override, clamped to `MAX_DEPTH` (callers can only lower it);
* adds defence-in-depth `RangeError` depth guards to the exported walkers
  (`compile.js#walk`, `stringify.js#walk`, `expand.js#walk`, `utils.js#flatten`) so hand-built
  ASTs cannot crash a process either;
* removes the leftover `console.log('node.isClose', prefix, node.value)` debug line in
  `lib/compile.js` (which is also a "stray logging" finding).

**Boundary, measured** (same envelope for the `{...}` and the `(...)` shape): nesting 1-99 is
accepted; nesting exactly 100 is refused by the walker guards with a controlled
`RangeError: AST nesting depth (101) exceeds max depth (100)` (the parser counts one level less than
the AST walkers do on that shape); 101 and above is refused earlier by `parse()` with
`SyntaxError: Input nesting depth (101) exceeds max depth (100)`. The effective ceiling is therefore
99 levels, and every depth above it is a controlled throw - never a stack overflow. Aligning the
parser and the walker accounting (so that 100 is accepted too) is left as a possible refinement; it
was not done here to keep the patch to the shape the advisory describes.

**Non-breaking argument:** for any AST produced by `parse()`, nesting is capped at 100 and the AST
walkers refuse anything deeper than 100, so no input reaches deep recursion. `micromatch`/`picomatch`
swallow both errors and fall back to a literal, non-matching matcher (measured: `isMatch` returns
`false` without throwing for nesting 99, 100, 101 and 2000), which is why callers never see a crash.

### Resolution: `braces` was removed from the tree entirely (2026-10-13)

The patch was a stopgap: version-based scanners (OSV, `npm audit`, Aikido) keep reporting
CVE-2026-93687 for as long as the installed version string stays `3.0.3`. The follow-up work landed
in `plans/2026-10-13-eslint-9-flat-config-and-tailwind-4.md` and deleted every path that pulled
`braces` in:

* runtime: `chokidar` `^3.6.0 -> ^5.0.0` (`Watcher.ts` needed no change - see the correction below);
* build: `tailwindcss` `^3.4.3 -> ^4.3.3` (v3 dragged in `fast-glob`/`micromatch`),
  `typescript-eslint` 8 (`fast-glob`/`globby` via `ts-estree`/`@typescript-eslint/typescript-estree`),
  and the frontend dropping `eslint-config-neon` + `@next/eslint-plugin-next`;
* the two `resolutions` entries and `.yarn/patches/braces-npm-3.0.3-582c14023c.patch` were deleted.

Verified after `yarn install`: `node_modules/braces` does not exist, `yarn.lock` contains no
`braces@…` entry and no `braces-npm` patch reference, and `yarn why braces` / `fast-glob` /
`globby` return nothing (`micromatch` is gone as well). There is nothing left for a version-based
scanner to match, so the "residual finding" this document recorded no longer applies.

**Correction to the original follow-up note:** chokidar v4 (and v5) did **not** remove the
`alwaysStat` option - it is still declared in `BasicOpts` in `chokidar@5.0.0/index.d.ts`, and
`add`/`addDir`/`change` still pass `stats` as the second argument. Confirmed against the installed
package: `watch(dir, { ignoreInitial: true, alwaysStat: true })` skipped the pre-existing file and
emitted `add` for a new one with `stats.size === 11`. Only glob support was dropped, and
`Watcher.ts` watches a single directory path. chokidar 5 makes the package ESM-only (the backend is
ESM and requires Node >= 22), so `Watcher.ts` is unchanged.

## 2. Sensitive data in logs

| # | Site | Problem | Fix |
| --- | --- | --- | --- |
| 2.1 | `backend/src/utils/Logger.ts` | production `redact.paths` was only `['hostname']`; no coverage for credentials | new `utils/Sanitizer.ts` + a deterministic recursive scrubber wired in as `formatters.log`, plus a header `redact.paths` matrix as a second net |
| 2.2 | `backend/src/routes/admin/service/Diagnostic.ts` | returned `envinfo` **plus the entire raw log file** (absolute filesystem paths, client IPs, usernames) in the API response | new `utils/LogSanitizer.ts`: last 500 lines, app root -> `<app>`, remaining absolute paths (POSIX + Windows) -> `<path>`, client addresses -> `<redacted>` |
| 2.3 | `backend/src/middlewares/auth.ts` | `Request from user: ${user.username}` on every request (PII) | log the numeric user id instead |
| 2.4 | `backend/src/structures/routes.ts` | `server.log.debug(inspect(options))` dumped the whole route options object | log method/url/middleware names only |
| 2.5 | `backend/src/utils/UpdateCheck.ts` | `log.error(await res.json())` dumped an external response payload | log the HTTP status only |
| 2.6 | `SaveSettings.ts`, `main.ts`, `ChangePassword.ts`, `Register.ts`, upload/album routes | `log.error(error)` - Prisma/zod/JSON errors can embed request bodies and the settings payload (JWT secret, S3 keys) | new `logError(context, error)` helper: message-only in production, full stack in development |
| 2.7 | Next.js frontend + `uploader-client` + `uploader-module` | raw `console.log/error(error)` printed API error bodies in the browser console | server components behind `NODE_ENV !== 'production'`, client components through the existing no-op-in-production `debug()` helper |
| 2.8 | `node_modules/braces/lib/compile.js` | leftover `console.log('node.isClose', ...)` debug statement | removed by the patch in section 1 |

**Deliberate decision:** the client IP is *kept* in the on-disk logs (it is needed for abuse
investigation) and redacted **only** on the diagnostics egress path (2.2). Absolute filesystem
paths are removed from logs in production at the source (2.6) and additionally stripped at the
egress path as defence in depth.

**Why not `redact.paths` alone (2.1):** path-based redaction relies on `fast-redact` wildcards, and
a live probe showed that `*.jwtSecret` does **not** match `user.jwtSecret` even though `*.password`
does — the wildcard only descends one level and silently misses siblings. Credentials reach the
logger in arbitrarily shaped payloads (settings rows, `req` objects, third party error data), so
the primary net is now a recursive walk over the log record (`scrubSensitiveValues`, depth 6) that
replaces any value whose key normalises to a credential name (exact, suffix or substring match, so
`password`, `newPassword`, `x-api-key`, `jwtSecret`, `S3SecretKey` and `botToken` are all covered).
The pino `redact.paths` list is kept for the header names Fastify hands over directly.

**Second gap found while probing:** `pino` copies every own enumerable property of an error, so a
raw `log.error(error)` printed Prisma `meta`, zod `issues` and the settings payload (JWT/S3
secrets) verbatim. The `err` serializer now keeps only `type`/`message`/`code`/`stack`, redacts
credentials and paths in the message, reduces stack frames to `file.js:line:col`, and collapses any
non-`Error` value (an SDK response object, an issue list) to its `typeof`.

## 3. Verification performed

### `braces` patch

Byte-identical output before/after on 15 real-world pattern families (`{a,b}`, `a{b,c}d`,
`{1..5}`, `{a..e..2}`, `!(a|b)`, `{{a,b},c}`, `a/{b,c/{d,e}}`, `{a,b}{c,d}`, `x{a,{b,c}}y`,
`{a,b(1..3)}`, `[{a,b}]`, `{a..c}{1..3}`, `a{b,c{d,e}f}g`, `{1..10..2}`, `\{a,b}`) across
`expand`, `compile` and `stringify`; nesting 1-99 accepted, 100 refused by the walker guards, 101+
refused by `parse()` (both controlled throws); `options.maxDepth`
honoured and clamped; hand-built >100-deep ASTs rejected by every walker with `RangeError`; no
stray `console.log` left in `compile`. `micromatch` behaves identically on 8 pattern families
(it internally catches the brace error and falls back to a non-matching matcher, so it never
crashes), and `chokidar` still emits `add` events with stats.

Pre/post comparison against a pristine `braces@3.0.3` extracted from the Yarn cache
(`braces-npm-3.0.3-582c14023c-10c0.zip`), using the maximum nesting reachable under the
10000-character cap (`'{a,'.repeat(2499) + 'a' + '}'.repeat(2499)` and
`'('.repeat(4999) + 'a' + ')'.repeat(4999)`):

| Stack size | Pristine `braces@3.0.3` | Patched |
| --- | --- | --- |
| 256 KB | `RangeError: Maximum call stack size exceeded` | `SyntaxError: Input nesting depth (101) exceeds max depth (100)` |
| 512 KB | `RangeError: Maximum call stack size exceeded` (parens) | `SyntaxError: ...` |
| 1024 KB+ | survives on this build | `SyntaxError: ...` |

The crash is therefore stack-size dependent (worker threads, Windows' 984 KB default stack and
memory-constrained containers all reach it); the patch makes the rejection deterministic on
every stack size.

Harnesses, re-run after the logging work with the same results: `/tmp/braces-stack-runner.cjs` driven
by `node --stack-size=256|512|1024` (produced the table above), `/tmp/braces-before-after.cjs`
(pristine vs patched on 8 repros: the pristine expands the 2499-level pattern and returns 2500
results, the patched one throws the controlled `SyntaxError`; the `maxLength` cap behaves
identically in both), and `/tmp/braces-consumer-test.cjs` (12 checks: both crash repros rejected,
8 `micromatch` pattern families unchanged, `micromatch` returning `false` instead of throwing on a
2000-level pattern, `chokidar` emitting `add` with stats).

### Logging fixes

* 29-assertion live probe (`/tmp/log-redaction-probe.mjs`) against the **built** backend, all
  passing: credential pairs in JSON/plain text, `Bearer`/`Basic` values, bare JWTs, nested and
  array-nested credential keys (`password`, `jwtSecret`, `apiKey`, `newPassword`), the app root and
  foreign absolute paths (POSIX, Windows, `file://`), stack frame reduction, the diagnostic export
  (path, client address, hostname, credential, user id and the 500-line truncation) and the real
  production logger writing to `logs/`.
* Hostile record written through the real production logger -> fresh log line keeps
  `req.method/url/ip`, `user-agent`, `pid` and the marker, while `req.headers.authorization`,
  `cookie`, `x-api-key`, `settings.password`, `settings.jwtSecret`, `settings.S3SecretKey` and
  `hostname` are gone/redacted, the error message reads
  `Failed to open <app>uploads/x.png with password: <redacted>`, the stack is
  `at log-redaction-probe.mjs:135:18`, and a non-`Error` `err` becomes `{"type":"object"}`.
* Development logger (pretty transport, full stacks) logs 0 occurrences of the planted credentials.
* `LogSanitizer` run over the two real rotated logs (`logs/safestorage-2026-10-12.log`, 71 lines,
  and `-10-13.log`, 18 lines): no absolute path, no client address, no hostname, no credential -
  including the lines the pre-fix code had written with a raw app-root path and a raw client IP.
* `yarn install --immutable` passes (this ran with the local patch registered; the patch has since
  been removed entirely - see the resolution section above).
* Backend `build` + `lint` (prettier + eslint) pass. `uploader-client` and `uploader-module` build.
  `next lint` reported only the pre-existing `FilesWrapper.tsx` `react/no-unused-prop-types` error
  (untouched by this change). Both the tool (`next lint`) and that error are resolved by
  `plans/2026-10-13-eslint-9-flat-config-and-tailwind-4.md`.

