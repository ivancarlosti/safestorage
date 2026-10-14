# API reference

SafeStorage exposes a JSON REST API under the `/api` prefix. Every instance also serves an **interactive, generated reference** (Scalar + OpenAPI) at:

```
https://<your-domain>/docs
```

which is always in sync with the running backend. This page is the static, human-readable companion to it.

-   **Base URL:** `https://<your-domain>/api`
-   **Content type:** JSON (`application/json`), except the streaming upload/download endpoints.
-   **Collection:** an Insomnia collection lives at [`packages/backend/insomnia.json`](../packages/backend/insomnia.json). It uses the Insomnia v4 export format, so it can also be imported into Thunder Client, Postman and other clients that read that format.

## Authentication

Every route declares which middlewares it runs. The three relevant ones are:

| Requirement | What it means                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------- |
| **Public**  | No credentials needed.                                                                          |
| **API key** | Supply your key in the `X-API-KEY` request header.                                              |
| **Auth**    | Supply a JWT — via the `token` cookie **or** an `Authorization: Bearer <jwt>` header.           |
| **Admin**   | Authenticated user must hold the `admin` role.                                                  |
| **Owner**   | Authenticated user must hold the `owner` role (a sub-set of admin routes, e.g. promote/demote). |

### JWT (browser / session)

`POST /api/auth/login` returns the token in the body **and** sets it as an `httpOnly` cookie named `token`:

```jsonc
{
	"message": "Successfully logged in.",
	"token": "eyJhbGciOi...",
	"user": { "id": 1, "uuid": "…", "username": "admin", "roles": [{ "name": "owner" }], "apiKey": "…" }
}
```

The JWT is signed with the instance secret, is valid for **30 days**, and is invalidated automatically when the account's password changes. The credentials are the user's **email** — the `username` column stores it — and password; the older `username` body field is still accepted as an alias. When the instance runs with `AUTH_METHOD=keycloak` this endpoint is disabled: it answers `403` and the browser is expected to use the single sign-on routes below instead.

For programmatic use, send it either way:

```bash
# Cookie
curl -b "token=$TOKEN" https://example.com/api/user/me

# Authorization header
curl -H "Authorization: Bearer $TOKEN" https://example.com/api/user/me
```

### API key (scripts / integrations)

Each user has a permanent API key (regenerate it with `POST /api/auth/apikey/change`). Send it as:

```bash
curl -H "X-API-KEY: $API_KEY" https://example.com/api/files
```

An `X-API-KEY` authenticates the request on its own — no JWT required.

## Rate limiting

A **global** limit applies to the whole API, configurable in the admin panel:

-   default: **100 requests per 1000 ms** per client (`rateLimitMax` / `rateLimitWindow`).
-   `POST /api/auth/login` and `POST /api/auth/register` override this with a stricter **10 requests per minute**.

In addition, every request passes through an IP-ban check first, so banned addresses are rejected before any handler runs.

## Errors

Errors use the standard HTTP status codes with a JSON body:

```jsonc
{ "message": "Wrong Username or Password", "statusCode": 401 }
```

`401` = missing/invalid credentials, `403` = authenticated but forbidden (e.g. disabled account, non-admin), `404` = not found, `429` = rate limited. `POST /auth/login` additionally answers `400` when the reCAPTCHA token is missing or rejected.

The **Keycloak callback is the exception**: it is reached by the browser, so it never returns JSON. Every failure redirects to `/login?error=<code>`, where the code is one of `access_denied`, `email_not_verified`, `invalid_request`, `invalid_state`, `invalid_token`, `not_allowed`, `server_error` or `user_disabled` (or whatever the provider itself appended, which the page shows as a generic message).

---

## Endpoints

Paths below are relative to `/api`.

### Server

| Method | Path             | Access | Description                                                         |
| ------ | ---------------- | ------ | ------------------------------------------------------------------- |
| GET    | `/health`        | Public | Application health status (used by the container healthcheck).      |
| GET    | `/version`       | Public | Backend version.                                                    |
| GET    | `/settings`      | Public | Public instance settings (branding, feature flags, …).              |
| GET    | `/settings/:key` | Public | A single setting. Authenticated users also see non-public settings. |

`/settings` is also where a client discovers the authentication setup: `authMethod` is `account` or `keycloak`, and `recaptchaSiteKey` is present only when reCAPTCHA is enabled, in which case a login must include the token it produces.

### Auth

| Method | Path                       | Access          | Description                                          |
| ------ | -------------------------- | --------------- | ---------------------------------------------------- |
| POST   | `/auth/register`           | Public (10/min) | Register a new account (may require an invite code). Only with `AUTH_METHOD=account`: with `keycloak` it answers `403` before the invite is even looked at. |
| POST   | `/auth/login`              | Public (10/min) | Log in with email + password; returns a JWT and sets the `token` cookie. Only with `AUTH_METHOD=account`. |
| GET    | `/auth/keycloak/login`     | Public          | Start the single sign-on flow: redirects the browser to the configured provider. |
| GET    | `/auth/keycloak/callback`  | Public          | The provider's redirect target: verifies the response, provisions the account if needed, sets the `token` cookie and redirects to the dashboard. Failures redirect to `/login?error=<code>`. |
| POST   | `/auth/password/change`    | Auth            | Change the authenticated user's password. Only with `AUTH_METHOD=account`; with `keycloak` it answers `403`, as the password belongs to the provider. |
| POST   | `/auth/apikey/change`      | Auth            | Generate / replace the authenticated user's API key. Available with both methods. |

### User

| Method | Path       | Access | Description                                                    |
| ------ | ---------- | ------ | -------------------------------------------------------------- |
| GET    | `/user/me` | Auth   | The authenticated user: roles, files, albums, stats and quota. |

### Albums

| Method | Path                               | Access | Description                            |
| ------ | ---------------------------------- | ------ | -------------------------------------- |
| GET    | `/albums`                          | Auth   | List the user's albums.                |
| POST   | `/album/create`                    | Auth   | Create an album.                       |
| GET    | `/album/:uuid`                     | Auth   | Get an album.                          |
| POST   | `/album/:uuid/edit`                | Auth   | Edit an album (name, description, …).  |
| DELETE | `/album/:uuid`                     | Auth   | Delete an album, keeping its files.    |
| DELETE | `/album/:uuid/purge`               | Auth   | Delete an album **and** its files.     |
| POST   | `/files/album/add`                 | Auth   | Add several files to an album.         |
| POST   | `/files/album/remove`              | Auth   | Remove several files from an album.    |
| POST   | `/files/albums`                    | Auth   | Which albums a set of files belong to. |
| POST   | `/album/:uuid/link`                | Auth   | Create a public link for an album.     |
| GET    | `/album/:uuid/links`               | Auth   | List an album's links.                 |
| POST   | `/album/:uuid/link/:linkUuid/edit` | Auth   | Edit an album link.                    |
| DELETE | `/album/:uuid/link/:linkUuid`      | Auth   | Delete an album link.                  |
| GET    | `/album/:identifier/view`          | Public | Get a public album by its identifier.  |
| GET    | `/album/:identifier/view/count`    | Public | Increment a public album's views.      |

> `GET /album/:identifier/zip` exists in the source but its URL is **commented out**, so it is not registered and cannot be called.

### Files

| Method | Path                               | Access        | Description                                                   |
| ------ | ---------------------------------- | ------------- | ------------------------------------------------------------- |
| GET    | `/files`                           | Auth          | List the user's files (paginated, filterable).                |
| GET    | `/file/:uuid`                      | Auth          | Get a single file.                                            |
| DELETE | `/file/:uuid`                      | Auth          | Delete a file.                                                |
| POST   | `/files/delete`                    | Auth          | Bulk-delete files.                                            |
| GET    | `/file/:uuid/download`             | Public        | Download a file with its original file name.                  |
| GET    | `/file/:uuid/highlight`            | Public / Auth | Highlight data used by embeds (the owner sees extra fields).  |
| POST   | `/file/:uuid/thumbnail/regenerate` | Auth          | Regenerate one file's thumbnail.                              |
| POST   | `/files/thumbnail/regenerate`      | Auth          | Regenerate thumbnails in bulk.                                |
| POST   | `/file/:uuid/album/:albumUuid`     | Auth          | Add a file to an album.                                       |
| DELETE | `/file/:uuid/album/:albumUuid`     | Auth          | Remove a file from an album.                                  |
| POST   | `/file/:uuid/tag/:tagUuid`         | Auth          | Add a tag to a file.                                          |
| DELETE | `/file/:uuid/tag/:tagUuid`         | Auth          | Remove a tag from a file.                                     |
| POST   | `/upload`                          | Public / Auth | Chunked upload endpoint (starts, receives chunks, completes). |
| POST   | `/upload/process`                  | Public / Auth | Finalize/process an uploaded file.                            |
| POST   | `/upload/multipart/complete`       | Public / Auth | Complete an S3 multipart upload.                              |

> "Public / Auth" routes are reachable anonymously when **public mode** is enabled; when authenticated they attach the file to your account.

### Tags

| Method | Path          | Access | Description           |
| ------ | ------------- | ------ | --------------------- |
| GET    | `/tags`       | Auth   | List the user's tags. |
| POST   | `/tag/create` | Auth   | Create a tag.         |
| GET    | `/tag/:uuid`  | Auth   | Get a tag.            |
| DELETE | `/tag/:uuid`  | Auth   | Delete a tag.         |

### Links (URL shortener)

| Method | Path                      | Access | Description                          |
| ------ | ------------------------- | ------ | ------------------------------------ |
| GET    | `/links`                  | Auth   | List the user's links.               |
| POST   | `/link/create`            | Auth   | Create a short link.                 |
| DELETE | `/link/:identifier`       | Auth   | Delete a short link.                 |
| GET    | `/link/:identifier`       | Public | Resolve a short link.                |
| GET    | `/link/:identifier/count` | Public | Increment a short link's view count. |

### Snippets

| Method | Path                          | Access        | Description                      |
| ------ | ----------------------------- | ------------- | -------------------------------- |
| GET    | `/snippets`                   | Auth          | List the user's snippets.        |
| POST   | `/snippet/create`             | Public / Auth | Create a snippet.                |
| GET    | `/snippet/:uuid`              | Auth          | Get a snippet.                   |
| DELETE | `/snippet/:uuid`              | Auth          | Delete a snippet.                |
| GET    | `/snippet/public/:identifier` | Public        | Get a public snippet (rendered). |
| GET    | `/snippet/:identifier/raw`    | Public        | Get a snippet's raw content.     |

### Admin

All routes below require the **admin** role, except the two marked **Owner**. Paths are under `/api/admin`.

**Files**

| Method | Path                     | Description                         |
| ------ | ------------------------ | ----------------------------------- |
| GET    | `/files`                 | List every file on the instance.    |
| GET    | `/file/:uuid`            | Get any file.                       |
| DELETE | `/file/:uuid`            | Delete any file.                    |
| POST   | `/files/delete`          | Bulk-delete files.                  |
| POST   | `/file/:uuid/allow`      | Un-quarantine / allow a file.       |
| POST   | `/files/allow`           | Bulk-allow files.                   |
| POST   | `/file/:uuid/quarantine` | Quarantine a file.                  |
| POST   | `/files/quarantine`      | Bulk-quarantine files.              |
| POST   | `/files/purge/public`    | Purge all public/anonymous uploads. |

**Users**

| Method | Path                  | Description                           |
| ------ | --------------------- | ------------------------------------- |
| GET    | `/users`              | List all users.                       |
| GET    | `/user/:uuid`         | Get a user.                           |
| GET    | `/user/:uuid/files`   | Get a user together with their files. |
| POST   | `/user/:uuid/quota`   | Set a user's storage quota.           |
| POST   | `/user/:uuid/disable` | Disable a user.                       |
| POST   | `/user/:uuid/enable`  | Enable a user.                        |
| POST   | `/user/:uuid/purge`   | Purge a user and their files.         |
| POST   | `/user/:uuid/promote` | Promote a user to admin. **(Owner)**  |
| POST   | `/user/:uuid/demote`  | Demote an admin. **(Owner)**          |

**Invites**

| Method | Path             | Description       |
| ------ | ---------------- | ----------------- |
| GET    | `/invites`       | List invites.     |
| POST   | `/invite/create` | Create an invite. |
| POST   | `/invite/delete` | Delete an invite. |

**IP management**

| Method | Path              | Description                    |
| ------ | ----------------- | ------------------------------ |
| GET    | `/ip/list`        | List banned IPs.               |
| POST   | `/ip/ban`         | Ban an IP.                     |
| POST   | `/ip/unban`       | Unban an IP.                   |
| POST   | `/ip/files`       | List files coming from an IP.  |
| POST   | `/ip/files/purge` | Purge files coming from an IP. |

**Links**

| Method | Path                | Description      |
| ------ | ------------------- | ---------------- |
| GET    | `/links`            | List every link. |
| DELETE | `/link/:identifier` | Delete any link. |

**Service**

| Method | Path                   | Description                                 |
| ------ | ---------------------- | ------------------------------------------- |
| GET    | `/service/settings`    | Get all settings (including non-public).    |
| POST   | `/service/settings`    | Save settings.                              |
| GET    | `/service/statistics`  | Get server statistics.                      |
| GET    | `/service/diagnostic`  | Get a diagnostic report about the instance. |
| GET    | `/service/updateCheck` | Check whether a newer release exists.       |

> `POST /admin/file/:uuid/unzip` exists in the source but its URL is **commented out**, so it is not registered.
