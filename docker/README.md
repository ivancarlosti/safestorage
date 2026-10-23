# SafeStorage with Docker (pull only)

This folder contains everything needed to run SafeStorage **without the source
code**: one combined image (nginx + backend + frontend) is pulled from
`ghcr.io/ivancarlosti/safestorage`.

## Quick start

This folder ships two stacks; pick the one that matches your setup:

| File                        | Database                                                       |
| --------------------------- | -------------------------------------------------------------- |
| `docker-compose-bundle.yml` | an official `mariadb` container, started next to SafeStorage.   |
| `docker-compose.yml`        | a MariaDB/MySQL server you already run (`DATABASE_URL`).        |

**Bundled database** (nothing else to install):

```bash
cp .env.example .env   # edit ACCOUNT_LOGIN, ACCOUNT_PASSWORD, SAFESTORAGE_PORT and AUTH_METHOD
docker compose -f docker-compose-bundle.yml up -d
```

**Existing database:**

```bash
cp .env.example .env   # edit DATABASE_URL, ACCOUNT_LOGIN, ACCOUNT_PASSWORD, SAFESTORAGE_PORT and AUTH_METHOD
docker compose pull
docker compose up -d
```

Open `http://<host>:<SAFESTORAGE_PORT>` (default `24424`) and log in with the
email and password declared in `ACCOUNT_LOGIN`/`ACCOUNT_PASSWORD`. There is no
default account, so a fresh install needs that pair before the first start. The
schema is created on the first boot, and the database itself too when it does
not exist yet.

## Users & authentication

SafeStorage ships two ways to sign in and uses **one** at a time, chosen by
`AUTH_METHOD` in the same `.env` file (both stacks pass it through to the
container).

| `AUTH_METHOD`       | Login screen                         | Configure it with                    |
| ------------------- | ------------------------------------ | ------------------------------------ |
| `account` (default) | the email + password form in the UI  | `ACCOUNT_LOGIN` / `ACCOUNT_PASSWORD` |
| `keycloak`          | "Sign in with single sign-on" button | the `KEYCLOAK_*` variables           |

The accounts declared in `ACCOUNT_LOGIN` (comma-separated emails; the first one
becomes the `owner`) are created on the first boot. An instance that declares no
account starts with no users at all and logs a warning; nothing is created
implicitly (the old `ADMIN_PASSWORD` variable is gone). Setting
`RECAPTCHA_CLIENTID` and `RECAPTCHA_CLIENTSECRET` adds a reCAPTCHA v2 checkbox to
the login form.

For Keycloak, point `KEYCLOAK_BASE_URL` / `KEYCLOAK_REALM` at your realm,
register `https://<your-domain>/api/auth/keycloak/callback` as the client's
_Valid redirect URI_ and `https://<your-domain>/login` as its _Valid post logout
redirect URI_ (signing out ends the provider session and returns to the login
page), and list the people who may sign in in `KEYCLOAK_RESTRICT` (whole emails
or bare domains). The backend refuses to start with `AUTH_METHOD=keycloak` while
that allow-list is empty, so the first visitor cannot quietly claim the instance.

Every variable is documented in
[`../docs/configuration.md#authentication`](../docs/configuration.md#authentication).

## Data

Everything persistent lives next to this file (or in a named volume for the
bundle):

| Storage                        | Container path  | Contents                |
| ------------------------------ | --------------- | ----------------------- |
| `uploads`                      | `/app/uploads`  | files, thumbnails, zips |
| `logs`                         | `/app/logs`     | daily rotating logs     |
| `mariadb` volume (bundle only) | MariaDB datadir | the whole database      |

Back up the uploads, the logs and a database dump and you have a full backup.

## Operations

```bash
docker compose logs -f          # all logs (nginx, backend, frontend)
docker compose pull && docker compose up -d   # update
docker compose down             # stop (data stays on disk)
```

## Notes

-   TLS is **not** terminated in this container. Put it behind a reverse proxy
    (Traefik, Caddy, nginx, Cloudflare Tunnel, …) if you need HTTPS.
-   Files larger than 2 GB work out of the box: the bundled nginx streams request
    bodies without buffering them. The upload limit itself is the _Max Size_
    setting in `Admin > Settings`, so raise it for really large files.
-   Uploads to a network storage (S3/R2/Spaces/MinIO) go straight from the browser
    to the bucket: files up to 100 MiB use one pre-signed `PUT`, bigger files a real
    S3 multipart upload (2 parts at a time, failing parts retried, 12 h URL
    lifetime), so there is no 5 GB single-`PUT` ceiling. The backend collects the
    ETags itself, so the bucket does **not** need `ExposeHeaders: ETag` in its CORS
    rules.
-   When the network storage is enabled _all_ uploads go to the bucket (chunked
    uploads to the local disk are only used when it is disabled), so raise
    _Max Size_ there too.
-   External S3/R2/Spaces/MinIO storage is configured in
    `Admin > Settings > Network storage`; no extra service is shipped here.
-   `uploads/` and `logs/` are created automatically the first time you run
    `docker compose up` (Docker creates missing bind-mount sources as `root`);
    create them yourself beforehand if you need different ownership.
-   With `docker-compose.yml` there is no database inside the stack: point
    `DATABASE_URL` at a MariaDB/MySQL server. `host.docker.internal` resolves to
    the Docker host (the compose file maps it through `extra_hosts`), so a
    database installed on the machine is reachable as
    `mysql://user:password@host.docker.internal:3306/safestorage`.
-   `docker-compose-bundle.yml` runs MariaDB 11 in a container next to the app
    with its own `mariadb` volume. It ignores `DATABASE_URL` from `.env` and
    assembles its own connection string; change the credentials with the
    `MARIADB_*` variables instead.
-   The container is healthy when `GET /api/health` (backend) and `/` (frontend)
    both answer through nginx; `docker compose ps` shows the status.
-   Authentication is chosen by `AUTH_METHOD` in `.env` and applied at boot, so
    changing it — or any of the `ACCOUNT_*`, `KEYCLOAK_*` and `RECAPTCHA_*`
    variables — needs a restart (`docker compose up -d --force-recreate`). A
    sign-in that is still in flight through Keycloak is tracked in the process
    memory, so run a single replica.
-   `TZ` (default `UTC`) sets the timezone of the container logs. Use an IANA
    name such as `America/Sao_Paulo`; it is read at boot and also drives the
    nginx timestamps, so apply a change with
    `docker compose up -d --force-recreate`.
