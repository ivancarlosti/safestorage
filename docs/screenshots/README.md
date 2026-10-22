# Screenshots

The images in this folder are embedded in the project [README](../../README.md).
They are **generated**, never hand-edited: a headless browser drives a real
SafeStorage instance and photographs its pages.

| File                   | Page                                                      |
| ---------------------- | --------------------------------------------------------- |
| `home.png`             | Public landing page (`/`)                                 |
| `login.png`            | Login — account form (`/login`)                           |
| `login-keycloak.png`   | Login — single sign-on (`/login`, `AUTH_METHOD=keycloak`) |
| `dashboard.png`        | Uploads grid (`/dashboard`)                               |
| `albums.png`           | Album list (`/dashboard/albums`)                          |
| `album.png`            | A single album (`/dashboard/albums/<uuid>`)               |
| `public-album.png`     | Shared album view (`/a/<identifier>`)                     |
| `tags.png`             | Tag list (`/dashboard/tags`)                              |
| `snippets.png`         | Snippet list (`/dashboard/snippets`)                      |
| `snippet.png`          | A single snippet (`/dashboard/snippets/<uuid>`)           |
| `short-urls.png`       | Short URL manager (`/dashboard/links`)                    |
| `admin-settings.png`   | Admin → Settings (`/dashboard/admin/settings`)            |
| `admin-statistics.png` | Admin → Statistics (`/dashboard/admin/statistics`)        |
| `api-docs.png`         | The Scalar/OpenAPI reference (`/docs`)                    |

## Regenerating

```bash
cd docs/screenshots
./generate.sh
```

`generate.sh` pulls `ghcr.io/ivancarlosti/safestorage:latest`, boots it as a
throwaway container with temporary volumes, seeds it with **synthetic demo
data**, captures the pages above and then removes everything (container and
data) again. Nothing from a real instance ends up in the images.

The committed set was captured from an image **built from the checkout** instead:

```bash
docker build -t safestorage:local .                 # repository root
cd docs/screenshots
SAFESTORAGE_IMAGE=safestorage:local ./generate.sh
```

That is what you want whenever the change being documented lives in the source —
a published image only ever shows the state of its own release.

`authMethod` is resolved on the server from `AUTH_METHOD`, so the single sign-on
login screen cannot be captured from the same instance as the account form. The
script therefore boots a **second** throwaway container with
`AUTH_METHOD=keycloak` (and dummy `KEYCLOAK_*` values — the provider is never
contacted) purely to photograph its `/login` page.

> **Heads-up:** uploads only show thumbnails when the instance you capture from
> can generate them. `fluent-ffmpeg`'s format check fails against the `ffmpeg` 8
> runtime shipped by older builds, and those captures fall back to generic file
> icons. If that happens, build the image from your checkout and point the script
> at it:
>
> ```bash
> docker build -t safestorage:local .
> SAFESTORAGE_IMAGE=safestorage:local ./generate.sh
> ```

### Requirements

-   Docker
-   Node.js ≥ 20
-   A Chromium/Chrome build. `npm install` downloads Playwright's bundled
    Chromium; set `PW_CHANNEL=chrome` to use a system Chrome instead.

### Configuration

| Variable                    | Default                                   | Meaning                                                                                  |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `SAFESTORAGE_IMAGE`         | `ghcr.io/ivancarlosti/safestorage:latest` | Image to boot.                                                                           |
| `SAFESTORAGE_PORT`          | `24425`                                   | Host port to publish.                                                                    |
| `SAFESTORAGE_BASE_URL`      | –                                         | Skip Docker and use an instance you already run.                                         |
| `SAFESTORAGE_KEYCLOAK_URL`  | –                                         | Instance serving `AUTH_METHOD=keycloak` (for `login-keycloak.png` when not booting one). |
| `SAFESTORAGE_KEYCLOAK_PORT` | `SAFESTORAGE_PORT + 1`                    | Host port for the throwaway keycloak instance.                                           |
| `SAFESTORAGE_CONTAINER`     | `safestorage-screenshots`                 | Container name used for the throwaway run.                                               |
| `ACCOUNT_LOGIN`             | `owner@example.com`                       | Email of the account created on the throwaway instance.                                  |
| `ACCOUNT_PASSWORD`          | `safestorage-screenshots`                 | Password of that account.                                                                |
| `PW_CHANNEL`                | –                                         | Force a Playwright browser channel (e.g. `chrome`).                                      |

Examples:

```bash
# Use a locally built image instead of the published one
SAFESTORAGE_IMAGE=safestorage:local ./generate.sh

# Capture against an instance you are already running
SAFESTORAGE_BASE_URL=http://localhost:8001 ACCOUNT_LOGIN=owner@example.com ACCOUNT_PASSWORD=hunter2 ./generate.sh

# ... and capture the single sign-on login from a second instance you run
SAFESTORAGE_BASE_URL=http://localhost:8001 SAFESTORAGE_KEYCLOAK_URL=http://localhost:8002 ./generate.sh
```

### Using the Playwright Docker image

Instead of installing browsers locally, run the capture step inside Playwright's
image (mount the repo so the script can reach the instance on the host):

```bash
docker run --rm --network host -v "$PWD:/shots" -w /shots \
  mcr.microsoft.com/playwright:v1.64.0-noble \
  node capture.mjs
```

### What the demo data contains

Everything is synthetic and disposable: albums named _Team offsite_,
_Wallpapers_ and _Design references_; a handful of tags; two code snippets; a
few example short links; and nine abstract gradient images generated on the fly
by [`placeholders.mjs`](placeholders.mjs) and uploaded through the real
dashboard uploader. No user, file, IP or URL from any real instance is included.
