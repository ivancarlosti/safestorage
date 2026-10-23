# Surface the real reason for a `413` during uploads

**Status:** implemented
**Date:** 2026-10-22

## Goal

An upload above 100 MB failed on a production instance (`chunkSize` = 81 MB,
`maxSize` = 2 GiB) with the upload panel reporting only
`Chunks are too big. Stopping upload`. That text names the chunk size, but the
same message is produced for **every** `413`, so it points at the wrong setting
for most failures: the upload can also be refused because the file is above
**Max Size**, because the chunk count exceeds the size limit, or because an
upstream proxy rejects the request body.

Make the panel and the toast report the reason the backend actually returned,
and keep one rejected file from aborting the other uploads.

## Root cause

`packages/uploader-client/src/index.ts` mapped the status code to a fixed
string instead of reading the response:

```ts
} else if (response.status === 413) {
	options.onError?.(uuid, new Error(`Chunks are too big. Stopping upload`));
	StopUploadsBecauseError = true;
}
```

The backend answers a `413` with a JSON body that names the limit that was
reached (`packages/backend/src/routes/files/Upload.ts`, via
`@fastify/sensible`'s `payloadTooLarge`, so the text is in `message`):

| Message                              | Cause                                                                |
| ------------------------------------ | -------------------------------------------------------------------- |
| `File is too big`                    | The declared size is above **Max Size** (or the anonymous link cap). |
| `Chunk is too big`                   | A single body is above **Chunk Size**.                               |
| `Chunked upload is above size limit` | `chunkSize × totalChunks` is above **Max Size** + one chunk.         |

With `chunkSize` = 81 MB and `maxSize` = 2 GiB those checks only fail for a file
above 2 GiB (see the comment on `maxFileSize` in `Upload.ts`), so the generic
message also hid *why* the file was refused: a stale settings tab (a Max Size
that has since been raised), a cached bundle from before the size pre-flight
existed, or a file that is genuinely above 2 GiB.

The second defect is in the same branch: `StopUploadsBecauseError` was a
module-level flag, so a `413` on one file made every other uploader skip its
remaining chunks. A new upload also reset the flag for the one that was already
running, so the outcome depended on timing.

## Changes

### `packages/uploader-client/src/index.ts`

-   New `parseErrorMessage(responseText, status)`: returns the JSON `message`
    when the body has one, a fixed explanation for a `413` that is not JSON (an
    HTML error page from a reverse proxy, which never reaches the backend),
    and the raw body for everything else — the previous behaviour.
-   The chunked `413` branch awaits `response.text()` and reports
    `parseErrorMessage(...)`. `debug` logs the body, so a proxy page can be
    recognised from the console with `debug: true`.
-   The single-request (`XMLHttpRequest`) branch uses the same helper, so an
    HTML `413` no longer shows the whole markup in the toast.
-   `StopUploadsBecauseError` is now `stoppedBecauseError`, declared inside
    `safeStorageUploader`. Every call uploads one file, so a `413` still stops
    that file's remaining chunks but no longer touches the other uploads.

### `packages/next/src/hooks/useUploadFile.ts`

-   `uploadChunkSize` is computed once (`(isNetworkStored ? maxSize : chunkSize) || 81_000_000`)
    and used both for the uploader option and for the pre-flight message.
-   The **Max Size** pre-flight now names the chunk size and the chunk count,
    so the limits that apply are visible without opening `Admin → Settings`:
    `The file is 3.2 GB, but this instance allows at most 2.15 GB per file (it would be split into 40 chunks of 81 MB).`

### `docs/troubleshooting.md`

The `413` entry now maps each backend message to the setting to change and
explains that a `413` without a JSON message comes from an upstream proxy.

## Verification

1. `yarn workspace @safestorage/uploader-client build` (vite + dts) — clean.
2. `npx tsc --noEmit -p packages/uploader-client/tsconfig.json` — clean.
3. `yarn workspace @safestorage/next typecheck` — clean.
4. `npx eslint src/hooks/useUploadFile.ts` (in `packages/next`) — clean.
5. Runtime harness against the built `lib/index.js` with stubbed `fetch` and
   `XMLHttpRequest`, 9/9 checks passing:
    - a chunked `413` with `{"message":"File is too big"}` reports
      `File is too big`, sends exactly one request and never calls `onFinish`;
    - a chunked `413` with an HTML body reports the proxy explanation;
    - two concurrent uploads, one rejected with `Chunk is too big`: the
      rejected one reports the reason, the other still finishes;
    - a single-request `413` with a JSON body reports `File is too big`.

## Notes / known limitations

-   `413` is still not retried: it is a permanent answer, and retrying a chunk
    of the same size cannot succeed.
-   Instances that keep serving a cached bundle show the old text until the
    page is reloaded; the Dockerfile rebuilds `@safestorage/uploader-client`
    from `src/`, so a fresh deployment needs no extra step.
-   `packages/uploader-client` has no `lint`/`format` script, so the one
    pre-existing over-long line in `src/index.ts` was left untouched.
