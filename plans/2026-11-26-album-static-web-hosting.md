# Album static web hosting

## Context

SafeStorage albums are galleries: a public link shows a file listing and a viewer.
This plan adds an opt-in "static website" mode so an album can also be served as a
real website (HTML/CSS/JS/images), either through a path (`/site/{identifier}/…`)
or through a per-site subdomain (`{identifier}.{hostingDomain}`).

Static hosting is a riskier feature than a gallery: the served documents are
attacker-controlled HTML/JS on a shared origin. It is therefore **off by default**
(instance setting), opt-in per album (`albums.isWebsite`) and per link
(`links.serveWebsite`), and path mode always serves documents inside a CSP
`sandbox` without `allow-same-origin` so a site can never reach `/api` with the
cookies of a visitor.

## Goal

- An album can be flagged as a website (`isWebsite`).
- A public link of that album can be switched to "serve as a website"
  (`serveWebsite`), which requires a DNS-safe identifier.
- `/site/{identifier}` serves the album contents as a static site (path mode).
- Optionally, when a hosting domain is configured, `{identifier}.{domain}` serves
  the same site on its own origin (domain mode, full fidelity: real origin,
  localStorage, service workers, SPA routing).
- `/a/{identifier}` redirects to the website URL when the link serves a website,
  and keeps rendering the gallery otherwise.
- Nothing is exposed unless the instance setting is enabled **and** the album is a
  website **and** the link has `serveWebsite`.

## Steps

1. **Schema + migration** (additive, defaults only)
   - `albums.isWebsite Boolean @default(false)`
   - `links.serveWebsite Boolean @default(false)`
   - `files.sitePath String? @db.VarChar(1024)`
   - `settings.websiteHostingEnabled Boolean @default(false)`
   - `settings.websiteHostingDomain String @db.VarChar(255) @default("")`

2. **Settings plumbing**
   - `structures/settings.ts`: defaults, load from DB, `SETTINGS_META` entries.
   - `utils/AlbumWebsite.ts`: shared FQDN / DNS-safe identifier helpers.
   - `SaveSettings`: validate the hosting domain (bare FQDN, no scheme/path).

3. **Pure helpers + tests first**
   - `normalizeSitePath`: `webkitRelativePath || name`, reject `..`, absolute
     paths, control characters, empty segments, segments > 255, paths > 1024.
   - `buildSiteIndex`: oldest file wins, collisions reported as warnings.
   - `resolveSiteRequest`: `/` → `index.html`, `/dir/` → `dir/index.html`,
     extension-less `/dir` → `301 /dir/`, missing → `404.html` (status 404),
     percent-decoding done once, encoded traversal rejected.
   - `parseSiteHost`, `isDnsSafeIdentifier`, `getWebsiteUrl`.
   - `WebsiteSecurity.ts`: header constants (`sandbox` present, never
     `allow-same-origin`).

4. **Serving layer**
   - `utils/AlbumWebsiteServer.ts`: link/album validation, index building, local
     (`createReadStream`) and S3 (`GetObjectCommand`) streaming, `Range`/`HEAD`/
     `ETag`/`304`, cache policy (documents `no-cache`, assets immutable), views
     counted on documents only.
   - `routes/album/hosting/ServeAlbumWebsite.ts`: `/site/:identifier` (308 to the
     slash form) and `/site/:identifier/*`, `ignoreRoutePrefix`, raised rate limit.
   - `plugins/WebsiteHosting.ts`: `onRequest` hook that matches
     `Host = {identifier}.{hostingDomain}` and serves the site with
     `reply.hijack()` (no wildcard route, so the dev static server keeps working).

5. **API changes**
   - `CreateAlbum` / `UpdateAlbum`: `isWebsite`; disabling an album cascades
     `serveWebsite = false` on its links in a transaction.
   - `CreateAlbumLink` / `EditAlbumLink`: `serveWebsite`, validation matrix
     (global switch, album is a website, DNS-safe identifier, no `hideFiles`).
   - `GetAlbumLinks`: expose `serveWebsite` + computed `websiteUrl`.
   - `GetAlbum` / `GetAlbums`: expose `isWebsite`.
   - `GetAlbumWithIdentifier`: expose `websiteUrl` and skip the gallery payload
     when the link serves a website.
   - Uploads: `sitePath` (from `webkitRelativePath || name`) in `Upload`,
     `UploadProcess`, `handleUploadFile`, `storeFileToDb`, `useUploadFile`.

6. **UI**
   - `CreateAlbumDialog` and `AlbumSettingsDialog`: "Static website" switch gated
     on `settingsAtom.websiteHostingEnabled`.
   - `LinkSettingsDialog`: "Serve as a website" (exclusive with drop-only),
     shows the resulting URL.
   - Links table: "Website" badge.
   - `/a/[identifier]`: redirect to the website URL when hosted.

7. **Infra + docs**
   - `container/nginx.conf`: `location /site/` in the port-80 block and a
     dedicated `listen 8080` server for the per-site subdomains.
   - `Dockerfile`: `EXPOSE 8080`.
   - `packages/next/next.config.mjs`: dev rewrite for `/site/:path*`.
   - `docker/docker-compose-sites.yml` for domain mode.
   - `docs/configuration.md`, `docs/api.md`, `docs/architecture.md`.

8. **Validation**
   - `packages/backend/test/albumWebsite.test.ts`: traversal (`..`, `%2e%2e`,
     `%252e`), NUL, absolute paths, overlong segments, index/directory
     resolution, 404 fallback, host parsing, and a regression test that the path
     mode CSP contains `sandbox` and never `allow-same-origin`.
   - `yarn lint`, `yarn typecheck`, `yarn build`, backend tests, docker-compose
     smoke test.

## Risks

- **Untrusted documents on the app origin (path mode).** Mitigated by CSP
  `sandbox` without `allow-same-origin`, `nosniff`, `CORP: cross-origin`, and by
  the fact that the whole feature is off by default. Domain mode avoids the
  shared origin entirely and must be documented as requiring host-only cookies.
- **Path mode cannot use localStorage, service workers, push or `pushState`
  routing** (opaque origin). Documented; domain mode is the answer for SPAs.
- **Unknown files on a subdomain.** Domain mode serves whatever the album
  contains, so the operator must only point a wildcard DNS record at the hosting
  listener when they accept serving user content on their domain.
- **All S3 bytes are proxied** through the backend for correctness (per-file
  `Content-Type`, Range, security headers). Redirecting to pre-signed URLs is a
  possible later optimisation.
- **Path collisions** (two files with the same `sitePath`) cannot be resolved
  automatically: the oldest file wins and the collision is reported, so the
  owner can rename/remove one of them.
