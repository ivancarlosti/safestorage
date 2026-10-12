# Configuration

SafeStorage is configured in two places:

1. **Environment variables** — read at process start; good for deployment-level values (port, admin password, timezone).
2. **Admin settings** — stored in the database and edited from **Admin → Settings** in the web UI (`GET`/`POST /api/admin/service/settings`). These survive restarts and upgrades.

## Environment variables

| Variable                  | Used by              | Default                 | Description                                                                             |
| ------------------------- | -------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `PORT`                    | backend              | `8000`                  | Port the Fastify API listens on.                                                        |
| `HOST`                    | backend              | `localhost`             | Interface the API binds to. The container sets `0.0.0.0`.                               |
| `ADMIN_PASSWORD`          | backend              | `admin`                 | Password of the `admin` user **created on first boot only** (when no database exists).  |
| `TZ`                      | backend / container  | `UTC`                   | Timezone used for log timestamps.                                                       |
| `SKIP_MIGRATIONS`         | container entrypoint | _(unset)_               | If set to any non-empty value, the entrypoint skips `prisma migrate deploy` on start.   |
| `SAFESTORAGE_VERSION`     | backend / frontend   | `dev`                   | Release version stamp, shown in `/api/version`, the admin panel and the startup banner. |
| `SAFESTORAGE_COMMIT`      | backend              | `unknown`               | Git commit stamp of the running build.                                                  |
| `BASE_API_URL`            | frontend (dev)       | `http://localhost:8000` | Target of the development `/api` rewrite. Not used in production.                       |
| `NODE_ENV`                | both                 | —                       | `production` in the Docker image, which also disables the frontend rewrite.             |
| `NEXT_TELEMETRY_DISABLED` | frontend             | `1` in the image        | Disables Next.js telemetry.                                                             |

> **A note on migrations:** the container runs `prisma migrate deploy` automatically on every start (unless `SKIP_MIGRATIONS` is set). You normally never need to run migrations by hand; set `SKIP_MIGRATIONS` only if you manage the SQLite schema yourself.

The Docker Compose stack reads a `.env` file — see [`docker/.env.example`](../docker/.env.example) for the deployment-flavoured view of `SAFESTORAGE_PORT`, `SAFESTORAGE_TAG`, `ADMIN_PASSWORD` and `TZ`.

## Admin settings

All of the following live in **Admin → Settings**. Values are grouped by category (as shown in the UI).

### Service

| Setting                 | Type    | Default           | Description                                                                                         |
| ----------------------- | ------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `serviceName`           | string  | `change-me`       | The name of your instance, shown throughout the UI.                                                 |
| `serveUploadsFrom`      | string  | _(empty)_         | Full domain (incl. `https://`) that directly serves uploaded files, e.g. `https://cdn.example.com`. |
| `rateLimitWindow`       | number  | `1000`            | Rate-limit window in ms. **Requires a restart.**                                                    |
| `rateLimitMax`          | number  | `100`             | Max requests per window. **Requires a restart.**                                                    |
| `secret`                | string  | random (64 chars) | JWT signing secret. Changing it logs everyone out.                                                  |
| `disableStatisticsCron` | boolean | `false`           | Disable the nightly statistics collection job.                                                      |
| `disableUpdateCheck`    | boolean | `false`           | Disable the daily update check against GitHub releases.                                             |

_(`port`, `host`, `statisticsCron`, `updateCheckCron` and `enabledStatistics` are read-only/derived and not editable in the UI.)_

### Uploads

| Setting                                  | Type    | Default                                       | Description                                                                       |
| ---------------------------------------- | ------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| `maxSize`                                | number  | `1000000000` (1 GB)                           | Maximum size of a single upload, in bytes.                                        |
| `chunkSize`                              | number  | `81000000` (~81 MB)                           | Size of each chunk for chunked (large) uploads, in bytes.                         |
| `chunkedUploadsTimeout`                  | number  | `1800000` (30 min)                            | How long an unfinished chunked upload is kept before it is discarded.             |
| `generateThumbnails`                     | boolean | `true`                                        | Generate thumbnails for images and videos (video needs `ffmpeg`).                 |
| `generateOriginalFileNameWithIdentifier` | boolean | `false`                                       | Append the identifier to the original filename instead of a random name.          |
| `enableMixedCaseFilenames`               | boolean | `true`                                        | Allow mixed-case filenames.                                                       |
| `generatedFilenameLength`                | number  | `12`                                          | Length of randomly generated filenames (≥ 8 recommended).                         |
| `blockedExtensions`                      | string  | `.jar,.exe,.msi,.com,.bat,.cmd,.scr,.ps1,.sh` | Comma-separated list of blocked upload extensions.                                |
| `blockNoExtension`                       | boolean | `true`                                        | Block files without an extension.                                                 |
| `saveDuplicatesToAlbum`                  | boolean | `false`                                       | When a duplicate is uploaded into an album, add the existing file to it.          |
| `useNetworkStorage`                      | boolean | `false`                                       | Upload to S3-compatible storage instead of local disk. See [Storage](storage.md). |
| `S3Region`                               | string  | _(empty)_                                     | Region of the S3 bucket.                                                          |
| `S3Bucket`                               | string  | _(empty)_                                     | Bucket name.                                                                      |
| `S3AccessKey`                            | string  | _(empty)_                                     | Bucket access key.                                                                |
| `S3SecretKey`                            | string  | _(empty)_                                     | Bucket secret key.                                                                |
| `S3PathStyle`                            | boolean | `false`                                       | Use path-style requests (usually `true` for non-AWS providers).                   |
| `S3Endpoint`                             | string  | _(empty)_                                     | Custom endpoint; leave empty for AWS S3.                                          |
| `S3PublicUrl`                            | string  | _(empty)_                                     | Public base URL of the bucket (needed for AWS S3).                                |

### Users

| Setting             | Type    | Default | Description                                                                       |
| ------------------- | ------- | ------- | --------------------------------------------------------------------------------- |
| `publicMode`        | boolean | `false` | Allow uploads without being logged in.                                            |
| `userAccounts`      | boolean | `false` | When disabled, no one can register without an invite.                             |
| `usersStorageQuota` | number  | `0`     | Default storage quota per user, in bytes (`0` = unlimited). Overridable per user. |

### Customization

| Setting              | Type    | Default                                   | Description                                |
| -------------------- | ------- | ----------------------------------------- | ------------------------------------------ |
| `backgroundImageURL` | string  | _(empty)_                                 | Background image for the instance.         |
| `logoURL`            | string  | _(empty)_                                 | Logo shown in the header.                  |
| `metaDomain`         | string  | `https://your-domain.com`                 | Domain used for SEO meta tags.             |
| `metaDescription`    | string  | `description for please-change-me.com 🚀` | Meta description.                          |
| `metaKeywords`       | string  | `comma, separated, keywords, …`           | Meta keywords.                             |
| `metaTwitterHandle`  | string  | `@your-twitter-handle`                    | Twitter/X handle used in embeds.           |
| `useMinimalHomepage` | boolean | `false`                                   | Show a minimal homepage (upload box only). |

### Other

| Setting                | Type    | Default          | Description                                                                                               |
| ---------------------- | ------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `generateZips`         | boolean | `true`           | Allow generating ZIP archives from public albums.                                                         |
| `useUrlShortener`      | boolean | `false`          | Enable the built-in URL shortener.                                                                        |
| `generatedAlbumLength` | number  | `6`              | Length of generated album identifiers (≥ 4 recommended).                                                  |
| `generatedLinksLength` | number  | `8`              | Length of generated short-link identifiers (≥ 8 recommended).                                             |
| `defaultSortOrder`     | select  | `createdAt:desc` | Default sort order inside albums (`createdAt:desc`, `createdAt:asc`, `name:asc`, `name:desc`, `id:desc`). |

### Legal

These three accept **Markdown** and are shown as standalone pages. Leave a value empty to disable the page.

| Setting                     | Description                           |
| --------------------------- | ------------------------------------- |
| `privacyPolicyPageContent`  | Content of the privacy-policy page.   |
| `termsOfServicePageContent` | Content of the terms-of-service page. |
| `rulesPageContent`          | Content of the rules page.            |
