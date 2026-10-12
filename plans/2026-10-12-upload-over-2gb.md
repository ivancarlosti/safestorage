# Fix uploads larger than 2 GB

**Status:** implemented
**Date:** 2026-10-12

## Goal

Make files above 2 GB upload correctly (and above 5 GB when network/S3 storage is
used) on both storage backends:

1. **Disk storage** (default): chunked POSTs to `/api/upload`.
2. **Network storage** (S3, R2, Spaces, MinIO…): pre-signed URLs from `/api/upload`.

## Root causes

### A. Disk storage: chunk rounding false-reject

`@chibisafe/uploader-module` validates chunked uploads with

```js
maxChunkSize * totalChunks > maxFileSize; // → "Chunked upload is above size limit"
```

but the client computes `totalChunks = ceil(fileSize / chunkSize)`, so the
product always rounds **up** and is bigger than the real file size. With the
shipped defaults (`chunkSize = 81 MB`, `maxSize = 1 GB`) a 2 GB file that the
admin allowed by raising _Max Size_ to exactly 2 GB is rejected:

```
totalChunks = ceil(2 000 000 000 / 81 000 000) = 25
25 * 81 000 000 = 2 025 000 000 > 2 000 000 000  → 413
```

The bigger the file, the bigger the overshoot, so anything near the configured
limit fails — and since admins must raise _Max Size_ to allow >2 GB uploads,
that is exactly the case that breaks.

### B. Network storage: a single pre-signed `PutObject`

`useUploadFile.ts` sets `chunkSize = maxSize` whenever `isNetworkStored` is
true, so the browser always performs **one** `PUT` of the whole file to a
single pre-signed URL. That breaks for large files because:

-   S3/R2/Spaces single `PutObject` tops out at 5 GB, and anything above ~2 GB is
    unreliable (request timeouts, proxy buffering, 1 h URL expiry, no resume).
-   The pre-signed URL is signed with `ContentLength: size`, so any retry/proxy
    that alters the body length yields `SignatureDoesNotMatch`.
-   A single failure restarts the whole transfer.

## Changes

### A. Disk storage (`packages/backend/src/routes/files/Upload.ts`)

-   Pass `maxFileSize = SETTINGS.maxSize + SETTINGS.chunkSize` to `processFile()`
    so the module's conservative `chunkSize * totalChunks` check no longer rejects
    a file that legitimately fits: the rounding overshoot is bounded by one chunk.
-   Enforce the real limit ourselves:
    -   reject when the client-declared `size` exceeds `SETTINGS.maxSize`;
    -   the module's busboy limit (`maxChunkSize + 1024` per request) still caps what
        a malicious client can push per chunk.
-   Resulting tolerance: at most one chunk (`SETTINGS.chunkSize`) above _Max Size_.

### B. Network storage: real S3 multipart upload

Backend:

-   `packages/backend/src/routes/files/Upload.ts` (`uploadToNetworkStorage`):
    -   reject `size > SETTINGS.maxSize` with 413 (keeps quota/limits meaningful for
        S3 too — admins raise _Max Size_ as needed);
    -   small files (`size <= 100 MiB`): unchanged single pre-signed `PUT`;
    -   large files: `CreateMultipartUpload` + N pre-signed `UploadPart` URLs.
        `partSize = clamp(ceil(size / 1000), 5 MiB, 5 GiB)` → parts ≤ 1000 and each
        part within S3's 5 MiB–5 GiB window; URLs expire in 12 h (long transfers).
        Response adds `multipart: { uploadId, partSize, parts: [{ partNumber, url }] }`.
-   `packages/backend/src/routes/files/UploadMultipartComplete.ts` (new route
    `POST /api/upload/multipart/complete`, same `apiKey` + optional `auth`
    middleware as the other upload routes):
    -   `ListParts` (paginated) to collect `{ PartNumber, ETag }` **server-side**,
        so the browser never needs the `ETag` response header and users do not have
        to add `ExposeHeaders: ETag` to their bucket CORS rules;
    -   `CompleteMultipartUpload`; then the client calls the existing
        `POST /api/upload/process`, which `HeadObject`s the key, stores the record in
        the DB, computes quota and generates thumbnails — no logic duplicated.

Frontend:

-   `packages/next/src/lib/s3-multipart.ts` (new): uploads the parts with
    `XMLHttpRequest` (keeps per-part upload progress), 2 parts in parallel, every
    part retried up to 2 times (3 attempts, 3 s apart) before the upload is failed,
    and then calls `/api/upload/multipart/complete`.
-   `packages/next/src/hooks/useUploadFile.ts`: accepts the optional `multipart`
    descriptor; when present it uses the new uploader instead of
    `@chibisafe/uploader-client`, and reports progress through the same
    `uploadsAtom` entries (`bytesSent`, `progress`, `status`).
-   `packages/next/src/lib/dropzone.ts`: `getSignedUrl()` now forwards
    `multipart` from the API response.
-   `Dropzone.tsx`, `UploadTrigger.tsx`, `AlbumDropzone.tsx`: pass `multipart`
    through to `uploadFile()` (three one-line changes, no logic duplication).

### Compatibility

-   All `src/routes/**` files are auto-registered by
    `packages/backend/src/structures/routes.ts` (it walks the folder with
    `jetpack.findAsync` and imports each file's exported `options`), so
    `UploadMultipartComplete.ts` (`POST /upload/multipart/complete`) needed no
    manual wiring.
-   Old response (no `multipart` key) → old single-`PUT` code path, unchanged.
-   Server without the complete route → parts still land in the bucket, but the
    finalise call fails loudly (documented, not silently corrupt).

### C. Bugs found and fixed while verifying the flows

-   `packages/backend/src/routes/files/UploadProcess.ts`: the body schema ended with
    `.required()`, which also turns `.optional()` fields into required ones, so the
    frontend's `POST /api/upload/process` (`{ identifier, name, type }`) was always
    rejected with `sourceUrl: Required` — every upload to the network storage failed
    at the last step. `.required()` dropped: `identifier`/`name`/`type` stay
    required (they are plain `z.string()`), `sourceUrl` stays optional.
-   `packages/backend/src/routes/files/UploadMultipartComplete.ts`: same
    `.required()` pattern would make the optional `size` mandatory; removed so the
    schema matches the documented behaviour (the size cross-check is still applied
    whenever the client sends `size`, which it does).
-   `packages/backend/src/routes/admin/service/SaveSettings.ts`: the handler always
    ran `String(parsedSettings.chunkSize)` (and the same for `maxSize` /
    `usersStorageQuota`) even when those keys were not part of the request, so any
    partial settings update (e.g. only toggling `useNetworkStorage` through the
    API) wrote the literal `"undefined"` over the stored value. That reads back as
    `NaN`, which the frontend's `z.number()` schema rejects — i.e. _Max Size_
    silently disappears. The conversion is now skipped for absent keys (and the
    import order in the file was fixed, which `eslint` was failing on).
-   `packages/backend/src/routes/files/Upload.ts` (`uploadToNetworkStorage`): a
    chunked (multipart) POST while network storage is enabled crashed with
    `Cannot destructure property 'contentType' of 'req.body' as it is undefined`
    (500). It now falls back to `{}` and answers `400 Missing file information`.

## Verification

All of the following was run against the combined image built from this tree
(`docker build -t safestorage:test5 .`), with the app running from it
(`docker run … -p 24426:80 -v /tmp/ss-smoke6/{uploads,database,logs}:/app/…`) and
`nginx -t` passing. The same flows were run on the previous build of this tree
with identical results, so nothing in the last round of fixes regressed them.

1. **Disk storage, 2.5 GiB file** (`chunkSize = 81 MB`, `maxSize = 3072 MiB`)
   through nginx: 33 chunks answered `204` and the final (34th) chunk answered
   `200` with the file URL. The stored file is byte-identical to the source
   (`sha256 9679aa8d…`, 2 684 354 560 bytes), `GET /<file>` through nginx returns
   those same bytes, `Range: bytes=2684354000-2684354559` answers `206` with 560
   bytes, and the DB row reports `size: 2684354560`. Before the fix this upload
   was rejected with `Chunked upload is above size limit`.
2. **Network storage (S3), end to end** against a local S3 stub that implements
   `CreateMultipartUpload`, `UploadPart`, paginated `ListParts` (10 parts per
   page, `part-number-marker` honoured), `CompleteMultipartUpload`, `PutObject`,
   `HeadObject` and `GetObject` (`docker pull minio/minio` answers _pull access
   denied_ from this environment, so a purpose-built stub was used instead of
   MinIO):
    - 1 MiB file → single pre-signed `PUT` `200`, then `POST /api/upload/process`
      `200` and a DB row;
    - 120 MiB file (random data) → 24 parts of 5 MiB, all `PUT`s `200`;
      `ListParts` walked 3 pages (`marker=0 → 10 → 20`);
      `POST /api/upload/multipart/complete` `200`; the object in the bucket is
      byte-identical to the source (identical `sha256` for the source file and
      the downloaded object, e.g. `641d69dc…`);
    - completing that upload with `size: 999` answers
      `400 Not all parts of the file were uploaded, please try again` (the size
      cross-check protects against truncated files);
    - a chunked (multipart) POST while the network storage is enabled answers
      `400 Missing file information` instead of a 500;
    - both storage backends ended up in the same DB (3 file rows) and the objects
      in the bucket match the source files.
3. **Settings regression** (`SaveSettings.ts` fix): posting a full settings
   payload stores `maxSize = 3221225472`, `chunkSize = 84934656`,
   `usersStorageQuota = 0`; posting _only_ `useNetworkStorage` afterwards keeps
   all three values intact and `GET /api/settings` keeps answering numbers (with
   the old code they became `null`, which the frontend's `z.number()` rejects).
4. `yarn install --immutable` passes (3.5 s, only the pre-existing peer-dependency
   warnings), `yarn workspace @safestorage/backend build` (tsc, inside
   `docker build`) and the Next production build pass; `prettier --check` and
   `eslint` are clean on the touched files (and on `plans/*.md` +
   `docker/README.md`).
5. Rounding math checked against the reported scenario (2 GB file,
   `maxSize = 2 GB`, `chunkSize = 81 MB` → accepted).
6. nginx does not buffer or cap request bodies (see
   `2026-10-12-nginx-reverse-proxy.md`: `client_max_body_size 0`,
   `proxy_request_buffering off`).

## Known limitations

-   Multipart uploads store the S3 multipart ETag (`<hash>-<parts>`) as the file
    hash, so byte-identical files uploaded with a different part size are not
    de-duplicated against each other.
-   `AbortMultipartUpload` cleanup for abandoned uploads is left to the bucket's
    lifecycle rules (recommended: abort incomplete multipart uploads after 7 days).
-   Public-read ACL is only applied on the single-`PUT` path (DigitalOcean Spaces);
    multipart buckets should use a bucket policy instead.
