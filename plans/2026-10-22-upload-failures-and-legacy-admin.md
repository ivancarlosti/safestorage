# Surface failed uploads and drop the legacy `admin` seed

**Status:** implemented
**Date:** 2026-10-22

## Goal

Two unrelated but user-visible defects reported together:

1. A file above the configured **Max Size** (the report used ~100 MB) is never
   sent, yet the upload panel ends with **All uploads complete 🎉** and the
   backend logs show nothing at all.
2. The backend still seeds a hardcoded `admin` user (password from
   `ADMIN_PASSWORD`, falling back to `admin`) when no account is declared. This
   is a standing default credential and it is no longer needed now that
   `ACCOUNT_LOGIN`/`ACCOUNT_PASSWORD` exist.

## Root causes

### A. Silent upload rejection

`useUploadFile` starts tracking an upload before the file is validated:

```ts
onStart: (uuid, totalChunks) => setUploads(draft => draft.push({ …, processing: true }));
```

`safeStorageUploader` calls `onStart` **before** `validateOptions`,
`validateFileExtension` and `validateSize`, so an oversized file gets an entry
with `processing: true`, then `onError` with an entry that is marked failed but
never announced (no toast), and no HTTP request is made at all:

-   `UploadProgress` decided completion from `uploads.filter(f => f.processing).length === 0`,
    which is also true when *every* upload failed → the success banner.
-   Nothing reaches Fastify, so `docker logs` stays empty; the container nginx
    already streams bodies without a limit (`client_max_body_size 0`), so this
    was not a proxy 413.
-   The panel row only showed a red dot plus a tooltip, which is easy to miss.

The same pre-flight path is used for the network/S3 backend when
`getSignedUrl` fails (quota, blocked extension, S3 misconfiguration): those
errors only showed a toast and left no row behind.

Two latent bugs in the same code path are fixed as well:

-   `settings === null` (or `chunkSize === 0`) produced `chunkSize: 0`, hence
    `totalChunks = Infinity` and an endless loop in the uploader.
-   `SettingsForm` accepted `0` for **Chunk Size** and **Max Size**, which is
    what creates that state.

### B. Legacy `admin` seed

`createAdminUserIfNotExists()` created `admin` / `ADMIN_PASSWORD ?? 'admin'`
whenever `ACCOUNT_LOGIN` was empty. There is no migration involved: the row is
simply no longer created, and existing databases are untouched (so deployments
that already have `admin` keep working and can rename/delete it).

## Changes

### Uploads (`packages/next`)

-   `src/hooks/useUploadFile.ts`
    -   New `failUpload(file, message)`: pushes an error entry (with `file.name`
        and `bytesTotal`) into `uploadsAtom` **and** raises
        `toast.error(\`${file.name}: ${message}\`)`. Returned alongside
        `uploadFile`.
    -   `uploadFile` refuses early, through `failUpload`, when the settings are
        not loaded, when **Max Size** is `0`, and when the file is bigger than
        **Max Size** — the message names both sizes with `formatBytes`.
    -   Chunk size falls back to `81_000_000` (the shipped 81 MB default) instead
        of `0`, so a missing setting can no longer produce an infinite chunk
        count.
    -   `onError` upserts its entry (an error can arrive for a uuid that is not
        tracked yet) and always toasts.
-   `src/components/UploadProgress.tsx`
    -   Completion is computed from the entries themselves; with any
        `status === 'error'` the button switches to the destructive variant and
        reads **`N of M uploads failed`** instead of the success banner.
    -   The error reason is printed under the file name (not only in a tooltip)
        and gets a per-row remove button.
    -   `totalProgress` no longer divides by zero when every upload failed.
    -   **Clear all** shows for a single entry too, so a failed upload can be
        dismissed.
-   `src/components/Dropzone.tsx`, `AlbumDropzone.tsx`, `UploadTrigger.tsx`:
    the `'error' in target` branch of `getSignedUrl` now calls `failUpload`
    instead of only toasting, so the failure also lands in the panel.
-   `src/components/forms/SettingsForm.tsx`: `chunkSize` and `maxSize` are
    `.int().min(1)`.

### Accounts (`packages/backend`)

-   `src/utils/Util.ts`: `createAdminUserIfNotExists` → `createConfiguredAccounts`.
    The `admin` seed block is gone. With no `ACCOUNT_LOGIN` it logs:
    -   under keycloak: the existing "owner comes from the first SSO login" note;
    -   otherwise, if the `users` table is empty: a **warning** saying nobody can
        sign in and how to fix it;
    -   otherwise: an info line saying to sign in with an existing account.
-   `src/main.ts` calls the renamed function.
-   `src/structures/auth.ts`: the boot warning no longer mentions
    `ADMIN_PASSWORD`; it states that no account will be created.

### Deployment files & docs

-   `docker/docker-compose.yml`, `docker/docker-compose-bundle.yml`: removed the
    `ADMIN_PASSWORD` environment entry and documented that `ACCOUNT_LOGIN` is
    required on a fresh install.
-   `docker/.env.example`: replaced the `ADMIN_PASSWORD` block with the same
    warning.
-   `README.md`, `docker/README.md`, `docs/configuration.md`,
    `docs/deployment.md`, `docs/troubleshooting.md`, `docs/architecture.md`,
    `docs/development.md`: the `ADMIN_PASSWORD` row/section is gone, first-login
    instructions use the `ACCOUNT_LOGIN` email, and the uploads section gained an
    entry explaining failures that never reach the network tab.
-   `docs/screenshots/generate.sh`, `capture.mjs`, `README.md`: the throwaway
    screenshot instance is booted and logged into with
    `ACCOUNT_LOGIN`/`ACCOUNT_PASSWORD` (defaults `owner@example.com` /
    `safestorage-screenshots`).

## Verification

Automated (run here):

1. `yarn workspace @safestorage/backend build` — clean.
2. `yarn workspace @safestorage/next typecheck` — clean.
3. `yarn workspace @safestorage/next lint` — clean.
4. `docker build -t safestorage:upload-verify .` with the changed sources — clean.
5. `prettier --write` on every touched TS/TSX/MJS file — no reformatting left.
6. `node --check docs/screenshots/capture.mjs` and `sh -n docs/screenshots/generate.sh`.

Runtime, against that image plus a throwaway `mariadb:11.4` container
(`ACCOUNT_LOGIN=owner@example.com`, `ACCOUNT_PASSWORD=secret123` for the second
boot only, driven by Playwright on `/dashboard` with a 125,829,120-byte file):

1. Fresh database **without** `ACCOUNT_LOGIN`:
   - `WARN No ACCOUNT_LOGIN is configured and the database has no users, so nobody can sign in.`
     (plus the boot-time `validateAuthConfiguration` warning);
   - `select count(*) from users` → `0`: no `admin` row is seeded any more.
2. Restart **with** `ACCOUNT_LOGIN`: `Created 1 account(s) from ACCOUNT_LOGIN.`,
   `owner@example.com` exists with the `owner,admin` roles and logs in.
3. Restart again **without** `ACCOUNT_LOGIN` on that same database: `INFO No
   ACCOUNT_LOGIN is configured: sign in with an account already stored in the
   database.` and the user row is untouched.
4. **Max Size = 100 MB**, 120 MiB file: the button reads
   `1 of 1 upload failed`, the panel shows
   `big-120mb.bin — The file is 125.8 MB, but this instance allows at most 100 MB per file.`,
   a toast with the same text appears, and **zero** `/api/upload` requests are
   made (previously this ended with `All uploads complete 🎉`).
5. **Max Size = 2 GB**, same file: `All uploads complete 🎉`, **two**
   `POST /api/upload` chunk requests (81 MB + 39 MB) and the stored file is
   125,829,120 bytes.

## Notes / known limitations

-   `StopUploadsBecauseError` in `packages/uploader-client` is still a
    module-level flag, so one 413 can abort other files that are in flight. It is
    out of scope here (the client bundle is rebuilt from `src/` by the Dockerfile)
    and is the natural next hardening step. *Fixed in
    `plans/2026-10-22-upload-413-error-reporting.md`, together with the generic
    `Chunks are too big` text.*
-   No migration is shipped: databases that already contain the seeded `admin`
    keep that account. Removing it is a manual action in **Admin → Users**.
-   `packages/backend/src/prisma/migrations/20261014033039_seed_roles/migration.sql`
    still has a comment mentioning the old function name; migration files are
    immutable (Prisma checksums them), so it was left as-is.
