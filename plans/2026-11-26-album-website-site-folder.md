# Album website: provision a real `site/{identifier}/` folder

## Context

Album static web hosting exists (`albums.isWebsite`, `links.serveWebsite`,
`files.sitePath`, `/site/{identifier}/*` served by `handleWebsiteRequest`), but the
files of a website album are still stored the gallery way: `<random-id><ext>` in
`uploads/` locally or under the bucket root on S3. Only the *served* path keeps the
user's name.

That breaks the workflow a static site needs:

- `processDropItem()` flattens dragged/selected folders, so `css/app.css` is served
  as `app.css` and every `<link>`/`<img>` in the HTML breaks.
- `blockNoExtension` silently drops `CNAME`, `_headers`, `.well-known/*`.
- Hash dedupe plus append semantics: re-uploading a changed `index.html` creates a
  second row with the same `sitePath` and `buildSiteIndex` keeps the first, stale
  one; identical bytes at two paths 404.
- The bytes live under random names, so the tree cannot be synced with
  `rsync`/`rclone` or browsed on S3.

## Goal

- Enabling "web hosting" on an album provisions a folder for it:
  `uploads/site/{albums.identifier}/…` locally and `site/{albums.identifier}/…`
  on S3.
- Files uploaded into a website album keep their exact name and folder: no random
  identifier, no suffix, no slugification, exact case/unicode, `sitePath` from the
  browser's `webkitRelativePath`, the common top folder stripped for whole-folder
  uploads, replace-in-place on the same path, no thumbnails and no hash dedupe.
  `blockedExtensions` is still enforced, `blockNoExtension` is not applied.
- `/site/{linkIdentifier}/…` serves both legacy flat files and the new nested keys.
- Gallery, album cover and upload-panel previews of website files keep working
  through `GET /api/file/{uuid}/content`.

## Steps

1. Pure helpers in `utils/AlbumWebsite.ts` (`SITE_STORAGE_PREFIX`,
   `getSiteStorageKey`, `getSiteStorageDirectory`, `isSiteStorageKey`,
   `parseSiteStorageKey`, `isValidSiteStorageKey`, `stripCommonRootPaths`) with
   unit tests in `test/albumWebsite.test.ts`.
2. Schema + migration: `albums.identifier VARCHAR(32) UNIQUE NULL`,
   `files.name VARCHAR(2048)`.
3. Provisioning: `getUniqueAlbumIdentifier` checks `links` and `albums`,
   `ensureAlbumIdentifier`, hooks in `CreateAlbum`, `UpdateAlbum`; expose
   `siteIdentifier` from `GetAlbum`, select `identifier` in `GetAlbums`.
4. Upload target: `validateUploadTarget` returns `album: { id, identifier, isWebsite }`
   (`ensureAlbumIdentifier` backfills old website albums).
5. S3 upload: `sitePath` in the body, site storage key, no `public-read` ACL;
   `/upload/process` validates the key against the album, replaces in place,
   skips dedupe/thumbs, allows extension-less files; `/upload/multipart/complete`
   validates the key against the album.
6. Local upload: `handleUploadFile` website branch writes
   `uploads/site/{id}/{sitePath}` (overwriting in place), thumbnails skipped,
   `deleteFiles` prunes the emptied folders, `constructNetworkStorageUrl`
   encodes per segment. A gallery album keeps its flat name and only records
   `sitePath` (so a folder upload there keeps working).
7. `GET /api/file/:uuid/content` for gallery/preview links of nested keys,
   wired into `constructFilePublicLink` through a new `uuid` parameter.
8. Frontend: `processDropItem` returns `{ file, sitePath }` (recursing with the
   dropped folder names), `stripCommonRoot`/`processDropItems` strip the picked
   folder once per selection, `uploadEntries` is the single upload loop used by
   the three drop/pick components, `getSignedUrl`/`uploadFile` take `sitePath`,
   and the album page offers `FileTrigger acceptDirectory`.
9. UI: website toggle in the create dialog (copy + disabled state), site folder id
   in the album settings dialog, hints on the public album page.
10. Docs (`docs/storage.md`, `docs/configuration.md`) and the nginx `site/`
    hardening; validation through `yarn test`, `yarn lint`, backend build, Next
    `typecheck` and a local smoke test.

## Validation

- `yarn test` (backend): 46 tests pass, including the new `site/{id}/{path}` key
  tests and the `stripCommonRootPaths` cases.
- `yarn lint` (backend) and `yarn lint`/`npx tsc --noEmit` (next) are clean.
- Live smoke test against a throwaway MariaDB + the dev backend:
  - album created with `isWebsite` got `siteIdentifier: imgvng`;
  - `css/app.css` landed at `uploads/site/imgvng/css/app.css`, `CNAME` at
    `uploads/site/imgvng/CNAME`, `.well-known/assetlinks.json` nested as sent;
  - re-uploading `css/app.css` kept the uuid and replaced the bytes on disk and
    in the answers of `/site/gad5mg/css/app.css`;
  - `index.html` was served at `/site/gad5mg/` as `text/html` with the website
    CSP, `/site/gad5mg/CNAME` and `/site/gad5mg/.well-known/assetlinks.json`
    answered 200;
  - `/api/file/{uuid}/content` answered with `nosniff`, the sandbox CSP,
    `inline`, `no-cache` and the row's Content-Type;
  - deleting `css/app.css` pruned the empty `css/` folder;
  - `sitePath=../escape.css` and a blocked `.exe` were refused with 400;
  - a gallery album still stored its upload flat (`LSboBQ0WRdTL.txt`).

## Risks

- A public-read S3/Spaces bucket exposes `site/{id}/…` even with every link
  disabled: the `public-read` ACL is not sent for site uploads and a private
  bucket is documented as required.
- `files.name` grows to 2048 characters; `prefix + sitePath` must be validated
  before the insert and nothing may assume 255.
- Legacy flat site files keep their URLs, new files are nested; a `sitePath`
  present in both forms resolves to the newest row.
- Replace-in-place changes hash/size/uuid semantics: quota and upload
  notifications have to be re-checked for site files.
- `/api/file/{uuid}/content` is unauthenticated but uuid-obscured (same model as
  the existing uploads); quarantined files are never served.
- Unicode (NFD) and case must not be normalized (it would break references) but
  have to be tested on the S3 path.
