# Clear the undici DoS advisory and the remaining HIGH audit findings

**Status:** implemented
**Date:** 2026-10-24

## Goal

Close every HIGH advisory reported by a **recursive** workspace audit, without
introducing a container-sized change:

-   **GHSA-xjj6-f33q-929c** (CVE-2026-109869, HIGH) — `undici` crashes the
    Node.js process when a server answers with more than five content codings
    and closes the connection first. Patched in `7.30.1` / `8.12.2`.
-   **GHSA-qw65-cvwx-89v3** (CVE-2026-84292, HIGH) — `fast-uri` authority
    injection through an unvalidated port in `serialize()`. Patched in `3.1.7` /
    `4.1.4`.
-   **GHSA-mrhx-c7xc-m3w5** (HIGH) — `zod` exhausts memory while validating
    oversized constrained collections. Patched in `4.6.6`.

The other advisories fixed along the way are listed under *Changes*.

## Root cause

`yarn npm audit -A` reported nothing, because **Yarn 4 only walks direct
dependencies by default**; `-R` is required to walk the transitive graph. With
`-R` the path to the HIGH finding was:

```
@safestorage/backend
└─ @scalar/fastify-api-reference@1.74.0
   └─ @scalar/json-magic@0.15.7
      └─ undici@7.29.1            (pinned as "npm:7.29.1")
```

Nothing in our code imports `undici`: `@scalar/json-magic` loads it dynamically
from `fetch-public-url.js`, which is only reached when Scalar fetches a **remote**
spec. `packages/backend/src/main.ts` hands the docs plugin an inline
`configuration.spec.content`, so the vulnerable path was not practically
reachable — but it was still a HIGH in the shipped dependency tree.

The exact pin in `@scalar/json-magic` also meant a plain `yarn up` could never
move `undici`; only an upstream bump or a `resolutions` override could.

## Changes

### Scalar API reference 1.74 → 1.76, and zod 3 → 4

Bumping `@scalar/fastify-api-reference` to `^1.76.0` moved
`@scalar/json-magic` to `0.17.0`, which depends on `undici@8.12.3` — above every
patched threshold. `undici@7` is now absent from the tree entirely, so **no
`undici` resolution was added** (pinning it would have downgraded the 8.x line
that `json-magic` expects). The same bump dropped the duplicate
`fastify-plugin@4.5.1`; only `6.0.1` remains.

`zod@3.25.76` had to become `zod@^4.6.7` in both workspaces. The backend uses
`fastify-type-provider-zod`, which follows zod's majors strictly:

| provider  | zod     |
| --------- | ------- |
| `<= 4.x`  | `v3`    |
| `5.x–6.x` | `v4`    |
| `>= 7.x`  | `v4.2+` |

so `fastify-type-provider-zod` went to `^7.0.0`, and `openapi-types@^12.1.3` was
added to the backend dependencies to satisfy the provider's new peer.

Our schema code needed no rewrites — there is no `z.record(...)`,
`z.nativeEnum(...)`, `required_error`/`invalid_type_error`, `z.function(...)` or
`.merge(...)` in `packages/backend/src`, and the only `.transform(...)` is the
query-string `booleanSchema`, which is never serialized.

Two behavioural details were checked rather than assumed:

-   **v7 serializes with `z.encode()`**, i.e. against the **output** type, while
    v4 used `parse()`/`z.input`. Unidirectional transforms throw during encode,
    so a script walked all 93 route modules (342 schema entries) and asserted
    that no **response** schema contains a `ZodTransform`. Coercion is a pipe
    with a reversible side, so `z.coerce.number()` and `z.date()` encode fine.
-   The generated OpenAPI is equivalent, except that zod 4 now emits
    `additionalProperties: false` on the closed objects, which matches the
    runtime stripping behaviour.

The frontend only had one casualty: `SettingsForm.tsx` typed the form with
`z.infer<typeof formSchema>` (the **output**). Zod 4 types the **input** of
`z.coerce.number()` as `unknown`, so the resolver signature no longer matched.
The form is now declared as
`useForm<z.input<typeof formSchema>, unknown, FormValues>`, which is also a more
honest description: inputs arrive as strings and the resolver emits numbers.
`@hookform/resolvers@5.9.1` already supports zod 4 (`^3.25.0 || ^4.0.0`), so no
bump was needed there.

### fast-uri resolutions

`fast-uri` is used by `ajv` twice, at two majors. The root `resolutions` block
now pins each range to its patched release, following the existing scoped-key
convention of the repository:

```json
"fast-uri@^3.0.1": "3.1.9",
"fast-uri@^3.0.5": "3.1.9",
"fast-uri@^4.0.0": "4.2.3"
```

This closes GHSA-w74x-v6f9-j3xg (medium), GHSA-xhq7-xmqj-769h (low),
GHSA-wjr9-j795-jxcr (medium) and GHSA-333x-w4r6-6crp (low), and transitively the
older host-confusion/port advisories that were already below the installed
versions.

### Node.js floor → 22.19.0

`@scalar/json-magic@0.17.0` and `undici@8.12.3` both declare
`engines.node >= 22.19.0`, so every workspace manifest, the root manifest and
`docs/development.md` were raised from `22.12.0`. `.nvmrc` (22.23.3) and the
`node:22-alpine` base image already satisfy the new floor.

### Audit in CI

`.github/workflows/audit.yml` runs
`yarn npm audit -A -R --severity high` on pushes and pull requests to `main` and
on a weekly schedule. It installs with `--immutable` first, so a manifest bumped
without regenerating the lockfile fails there too. `docs/development.md`
documents the command and the `resolutions` convention.

## Verification

1.  `yarn install --immutable` — clean (only the pre-existing `@tremor/react`
    React 19 peer warning remains).
2.  `yarn why undici` — a single `undici@npm:8.12.3` under
    `@scalar/json-magic@npm:0.17.0`; `undici@7` is gone.
    `grep 'fastify-plugin@npm:^4.5.1' yarn.lock` — no match.
3.  `yarn npm audit -A -R --severity high` — `No audit suggestions` (exit 0).
4.  `yarn workspace @safestorage/backend build` — `tsc` + alias rewrite, clean.
5.  `yarn workspace @safestorage/next typecheck` — clean.
6.  `yarn lint` — both workspaces pass (backend Prettier check + ESLint).
7.  `yarn workspace @safestorage/next build` — compiles successfully.
8.  Runtime smoke test (no database) that registers `@fastify/swagger` with
    `jsonSchemaTransform` and `@scalar/fastify-api-reference@1.76.0` exactly as
    `main.ts` does: `GET /docs/` → 200 with the Scalar markup,
    `GET /docs/openapi.json` → 200 with the generated spec, a route with
    `z.date()`/`z.coerce.number()` responses serializes to JSON, and an invalid
    query string is rejected with 400.
9.  The route-schema sweep described above: 93 route modules, 342 schemas, no
    transform/JSON-Schema errors and no `ZodTransform` in any response schema.

## Notes / out of scope

-   Zod 4 also changes the client-facing surface of the generated docs
    (`additionalProperties: false`, `format: date-time` reuse), but the API
    payloads themselves are unchanged; the serializers were verified above.
-   `@hookform/resolvers@6` exists but is not needed: 5.9.1 already accepts
    zod 4.
-   The advisory that motivated the sweep, `undici`, is only imported
    dynamically by Scalar for remote specs; `main.ts` keeps passing the spec
    inline through `spec.content`, so nothing changed there.
