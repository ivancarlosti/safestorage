# Replace `Math.random()` in the local upload uuid

**Status:** implemented
**Date:** 2026-10-22

## Goal

Close GitHub code scanning alert **Insecure randomness #5**
(`js/insecure-randomness`, CWE-330/338) reported on
`packages/next/src/hooks/useUploadFile.ts`.

## Root cause

`failUpload()` runs when a file is refused before a single byte is sent — the
instance settings are still loading (`settings === null`), **Max Size** is `0`,
the file is bigger than **Max Size**, or `getSignedUrl` rejected the upload in
the `UploadTrigger`/`Dropzone`/`AlbumDropzone` pre-flight path. Such a failure
has no upload uuid yet (the uploader has not called `onStart`), so the hook
creates its own identifier to keep the entry visible in the upload panel:

```ts
uuid: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
```

`Math.random()` is a non-cryptographic PRNG. CodeQL treats a value named `uuid`
as a security-sensitive token, so the call is reported even though this value
never leaves the browser: it is only used as the React key in
`UploadProgress.tsx` and as the lookup key for
`draft.findIndex(entry => entry.uuid === uuid)` inside `uploadsAtom`.

## Changes

### `packages/next/src/lib/random.ts` (new)

`randomUuid()` returns an RFC 4122 version 4 uuid:

-   `crypto.randomUUID()` when the property is available;
-   otherwise 16 bytes from `crypto.getRandomValues()`, with the version
    (`0x40`) and variant (`0x80`) bits applied and the bytes hex-encoded into
    the canonical `8-4-4-4-12` layout.

The fallback is not optional here: `crypto.randomUUID()` is a **secure-context**
API (HTTPS or localhost only), while TLS is **not** terminated inside the
container (`container/nginx.conf` has a plain `listen 80`) and
`docs/deployment.md` documents an *optional* external reverse proxy. On a
plain-HTTP LAN install `crypto.randomUUID` is `undefined`, so calling it
directly would throw a `TypeError` exactly in the code path that reports
failures. `crypto.getRandomValues()` is exposed in both secure and insecure
contexts, so it is the correct primitive for the fallback. Both branches return
the same shape, so no caller can tell them apart.

### `packages/next/src/hooks/useUploadFile.ts`

-   Import `randomUuid` from `@/lib/random`.
-   The pushed entry now uses `uuid: \`local-${randomUuid()}\``.

The `local-` prefix is kept: those entries still have no server-side existence,
and the prefix keeps them distinguishable from the uploader's `uuid` v4 values
and from the backend's `uuidv4()` ids. `Date.now()` was dropped because a v4
uuid is already unique — the timestamp added nothing but a second collision
namespace. No other behaviour changes: the value is still a `string`, and
nothing parses or transmits it.

## Verification

Automated (run here):

1. `yarn workspace @safestorage/next typecheck` — clean.
2. `yarn workspace @safestorage/next lint` — clean.
3. `node node_modules/prettier/bin/prettier.cjs --check` on
   `src/lib/random.ts` and `src/hooks/useUploadFile.ts` — clean. (`npx prettier`
   fails in this checkout with `permission denied` on the `.bin` shim, so the
   binary is invoked through Node. This record is not Prettier-formatted on
   purpose: the workspace `format:check` glob is `ts/tsx/mdx` only, and the
   other `plans/*.md` use the same list indentation.)
4. A `node --experimental-strip-types` harness that imports the real module,
   checks the secure branch, then shadows `crypto.randomUUID` with `undefined`
   to force the fallback: both outputs match
   `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`
   (`c0b2fe15-…` and `52aa6843-…`), and 100 000 consecutive fallback calls
   produced 100 001 distinct values (no collisions).
5. `grep -rn "Math.random" packages/next/src` — the only remaining match is the
   explanatory comment in `src/lib/random.ts`; there are no call sites left.

The alert itself closes on the next CodeQL code-scanning run on `main`; the
CodeQL CLI is not part of this repository's toolchain.

## Notes / out of scope

-   `packages/backend/src/utils/videoPreview/FragmentPreview.ts:34` also uses
    `Math.random()`, but only to pick a random frame index for a video preview.
    It is not a security-sensitive value and is not part of the alert; it was
    left untouched.
-   The local entry still cannot be removed from the panel through the
    `/api/upload` abort route (it has no server-side id), which is unchanged
    behaviour from before this fix.
