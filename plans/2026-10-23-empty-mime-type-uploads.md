# Upload files with an empty MIME type to network storage

**Status:** implemented
**Date:** 2026-10-23

## Goal

With network storage (S3) enabled, uploading a file the browser cannot name
(an `.iso` image, for instance) failed with `400 Missing file information`
before a single byte was sent. Make the upload succeed, and keep the signed
`Content-Type`, the stored object metadata and the database row in sync.

## Root cause

`File.type` is an empty string for formats the browser does not recognise. That
empty string travelled unchanged through the sign request and hit a truthiness
check in `packages/backend/src/routes/files/Upload.ts`:

```ts
if (!contentType || !size || !name) {
	void res.badRequest('Missing file information');
	return;
}
```

Removing only the guard is enough to let the upload through: in this SDK
version (`@aws-sdk/s3-request-presigner` 3.1150) `prepareRequest` adds
`content-type` to the signer's `unsignableHeaders`, so a presigned `PutObject`
URL signs just `content-length;host` and an empty `Content-Type` header never
produced `SignatureDoesNotMatch`.

The fallback is still needed for the other two copies of the value: a single
PUT stores whatever header the browser sends (S3 defaults to
`binary/octet-stream` when none is sent), the multipart path sends `ContentType`
on the real, non-presigned `CreateMultipartUpload` call, and `UploadProcess`
writes the type it receives. Without a shared fallback the object metadata and
the database row disagree for exactly the files this bug is about, and an empty
header is also not a usable MIME type for downloads.

The database row is written later by `UploadProcess.ts`, which had the same
truthiness check on `type`.

## Changes

### `packages/backend/src/utils/UploadHelpers.ts`

- New `normalizeContentType(contentType)` returning
  `application/octet-stream` for an empty or missing value.

### `packages/backend/src/routes/files/Upload.ts`

- `contentType` is optional in the schema, so API clients that omit it are not
  rejected by validation with a generic `Validation error`.
- `uploadToNetworkStorage` only rejects on a missing size/name and signs
  `normalizeContentType(contentType)` in both `PutObjectCommand` and
  `CreateMultipartUploadCommand`.
- The disk upload path stores the same fallback in its upload metadata, so a
  file handled by `UploadProcess` never reaches the database with an empty
  type.

### `packages/backend/src/routes/files/UploadProcess.ts`

- `type` is optional in the schema, the handler no longer rejects a falsy
  value, and the file row is created with `normalizeContentType(type)`.

### `packages/next/src/lib/file.ts`

- New `getUploadContentType(file)`, the frontend counterpart of the backend
  helper.

### `packages/next/src/lib/dropzone.ts`, `packages/next/src/hooks/useUploadFile.ts`

- The sign request, the PUT `Content-Type` header, the XHR `postParams.type`
  and the `/upload/process` body all use `getUploadContentType(file)`. The
  header sent to S3 is therefore exactly the value the backend signed.
- `Dropzone.tsx`, `AlbumDropzone.tsx` and `UploadTrigger.tsx` need no change:
  they all upload through `useUploadFile`. `s3-multipart.ts` needs no change
  either — part URLs do not sign `Content-Type`; object metadata comes from
  `CreateMultipartUpload`.

## Verification

1. `yarn workspace @safestorage/backend build` — clean.
2. `yarn workspace @safestorage/next typecheck` and
   `yarn workspace @safestorage/next build` — clean.
3. `prettier --check` on every touched file, and `eslint` on the backend files
   and `src/hooks/useUploadFile.ts` — clean. The shared flat config's
   `**/lib/**` ignore also covers `packages/next/src/lib`, so `file.ts` and
   `dropzone.ts` are only type-checked and formatted (pre-existing behaviour).
4. Presign harness with dummy credentials: `X-Amz-SignedHeaders=content-length;host`
   for `ContentType` values `application/octet-stream`, `image/png` and `''`,
   confirming that `content-type` is unsignable in this SDK version and
   therefore cannot cause `SignatureDoesNotMatch`.

Manual, with network storage enabled:

- An `.iso` below the multipart threshold: the sign request succeeds, the PUT
  succeeds and `HeadObject` reports `Content-Type: application/octet-stream`.
- An `.iso` above the multipart threshold: the multipart upload completes and
  the object metadata is `application/octet-stream`.
- Both files show `application/octet-stream` in the database and download
  normally.
- `image/png` and `application/pdf` keep their real type in the signature,
  the object metadata and the database.
- With network storage disabled, PNG/PDF uploads are unchanged.

## Notes / known limitations

- The MIME type is still client-controlled; this only removes the empty-string
  failure and keeps the three copies of the value consistent.
- Objects already stored with an empty `Content-Type` are not rewritten.
- The type is deliberately taken from the client/upload metadata rather than
  from `HeadObject`: S3 stores `binary/octet-stream` when none was supplied
  and some S3-compatible providers are inconsistent, so reading it back could
  turn a real `image/*` into a generic type and break inline previews.
- The `type` fields of the `uploadsAtom` entries are display-only (nothing
  reads them), so they still copy `file.type`; only values that cross a
  boundary were normalised.
- `Content-Type` is not signed for a single PUT, so the backend cannot enforce
  the value the frontend sends there; the fallback guarantees what our own
  client sends and what the multipart path stores, not what a third-party API
  client chooses to send.
