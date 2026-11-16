# Neutralise stored XSS from uploaded files (GHSA-7hmq-gf2f-c9c9)

**Status:** implemented
**Date:** 2026-11-16
**Upstream:** chibisafe/chibisafe — `fix: xss injection (#779)`, released in `v6.6.0`
**Advisory:** [GHSA-7hmq-gf2f-c9c9](https://github.com/chibisafe/chibisafe/security/advisories/GHSA-7hmq-gf2f-c9c9) (HIGH, 8.7)

## Context

An upload keeps the extension the uploader chose (`blockedExtensions` only covers
executables, `.html` and `.svg` are allowed) and this repository serves
`/app/uploads` from the same origin as the application. A request for an
uploaded `.html` came back as `Content-Type: text/html` with no
`Content-Security-Policy` and no `Content-Disposition`, so the browser rendered
it as a page and its script ran **with the origin of the app**.

The session cookie is `HttpOnly` but same-origin requests carry it, and
`packages/backend/src/middlewares/auth.ts` accepts `req.cookies.token`, so the
script could call the API as whoever opened the link — an admin included.
With `anonymousUploadsEnabled` no account is needed at all.

Verified against the pre-change `container/nginx.conf` (real nginx 1.27, file
`poc.html` under `/app/uploads`):

```
HTTP/1.1 200 OK
Content-Type: text/html
Content-Security-Policy: <absent>
X-Content-Type-Options: <absent>
```

The upstream fix is not a new default blocked extension (files already stored
would stay dangerous); it hardens the response headers of the file server.

## Goal

Make uploaded files harmless documents, without breaking image, video, audio or
archive downloads and without changing user-facing behaviour of the app.

## Steps

1. **`container/nginx.conf`** — the `location /` that serves `/app/uploads` now
   adds, for stored files only:
   - `Content-Security-Policy: sandbox; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
   - `X-Content-Type-Options: nosniff`
   - `Access-Control-Allow-Origin: *` (native media viewers fetch from the sandbox's opaque origin)

   The `try_files $uri @frontend` fallback keeps its own (empty) header set, so
   the Next.js application is neither sandboxed nor CORS-open, and `/api/*` is
   untouched (it matches an earlier location).

2. **`packages/backend/src/utils/UploadSecurity.ts`** (new) — the same three
   values, exported as `UPLOAD_CONTENT_SECURITY_POLICY` /
   `UPLOAD_SECURITY_HEADERS` plus `applyUploadSecurityHeaders()`.

3. **`packages/backend/src/main.ts`** — the dev-only `@fastify/static` server
   (active when `NODE_ENV !== 'production'`) sends those headers through
   `setHeaders`, mirroring production.

4. **`packages/backend/test/uploadSecurity.test.ts`** (new) — Node's test runner
   through `tsx`, no database needed:
   - serves `poc.html` / `poc.svg` / `cat.png` from a temporary folder through
     the real helper and asserts `text/html` + `image/svg+xml` still come back,
     now carrying the sandbox policy, `nosniff` and the CORS header;
   - asserts `container/nginx.conf` applies the *same* policy string to the
     uploads location, that files still fall through to `@frontend`, and that
     `@frontend` inherits neither the CSP nor the CORS header.

5. **Scripts** — `test` in the root and backend `package.json`, `test` task in
   `turbo.json`.

6. **Docs** — `docs/deployment.md` ("Uploaded files are untrusted"),
   `docs/storage.md`, `docs/development.md`; `docker/` added to
   `.dockerignore` so the repository keeps the organization layout.

## Risks

- **Inline previews**: `<img>`/`<video>`/`<audio>` embeds are unaffected (the
  policy applies to documents, not to subresources), and Range requests still
  work with the headers attached. Opening an uploaded HTML/PDF in a new tab now
  shows a script-less, form-less document — that is the intended change.
- **Other storages**: files served directly from an S3 bucket keep their old
  behaviour; the README/docs tell operators to replicate the headers on their
  CDN/bucket policy.
- **Config drift**: the policy lives in two places (nginx and the dev server).
  The nginx assertions in the test fail if either side is edited alone.
- **Cached responses**: a CDN in front of the container keeps previously cached
  uploads until purged — documented.
- `.html`/`.svg` uploads stay allowed on purpose: blocking extensions does not
  protect already stored files and would remove a legitimate use case.
