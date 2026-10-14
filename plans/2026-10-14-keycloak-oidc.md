# 2026-10-14 — Keycloak/OIDC single sign-on next to the built-in accounts

## Why

SafeStorage only knew one way to sign in: a row in the `users` table with a bcrypt
password in it, created by the registration form or by the `admin` user that the
first boot seeds from `ADMIN_PASSWORD`. A deployment that already runs an identity
provider had to keep a second, local credential in sync by hand — and the seeded
`admin` account made that worse: its password lived in `.env`, was only read on the
very first boot and could never be rotated from the file again.

Two things were missing:

- a way to hand authentication over to an **OIDC provider** (Keycloak) so the user
  store, the MFA policy and the group/role model stay where they belong, and
- a way to **declare the accounts from the environment** (`ACCOUNT_LOGIN` /
  `ACCOUNT_PASSWORD`) instead of relying on a single hard-coded `admin` username.

### The identity model

Email is the canonical identity, for both methods. The existing unique `username`
column already holds it and is case-insensitively matched by the MariaDB
collation, so **no Prisma migration is needed**: the column keeps its name (many
rows, indexes and queries refer to it) but carries an email address. `AUTH_METHOD`
picks which of the two methods is allowed, and only one is active at a time:

| `AUTH_METHOD`   | Login screen                   | Registration | Change password |
| --------------- | ------------------------------ | ------------ | --------------- |
| `account` (def) | email + password form          | allowed      | allowed         |
| `keycloak`      | "Sign in with Keycloak" button | disabled     | disabled        |

## What changed

| Layer    | Change                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- |
| Backend  | New `structures/auth.ts`: env contract, email normalisation, allow-list, credential checking      |
| Backend  | New `utils/Auth.ts`: `signAuthToken()` (used by both login paths) and `verifyRecaptcha()`         |
| Backend  | New `utils/Keycloak.ts`: Authorization Code + PKCE, JWKS/ID-token verification, JIT provisioning |
| Backend  | New `GET /api/auth/keycloak/login` and `GET /api/auth/keycloak/callback`                          |
| Backend  | `utils/Util.ts` seeds one account per `ACCOUNT_LOGIN` entry (first one is the owner)             |
| Backend  | `utils/Requirements.ts` fails the boot on an incoherent auth configuration                        |
| Backend  | `Login.ts` / `Register.ts` / `ChangePassword.ts` accept emails and respect `AUTH_METHOD`          |
| Backend  | `GetSettings.ts` exposes `authMethod` and `recaptchaSiteKey` to the UI                            |
| Frontend | `login` page renders the SSO button or the form; `KeycloakLoginButton.tsx` added                   |
| Frontend | `LoginForm` / `RegisterForm` ask for an email; register and change-password hidden under keycloak  |
| Docker   | `docker/.env.example` documents the new variables; both compose files pass them through            |
| Docs     | `configuration.md`, `deployment.md`, `troubleshooting.md`, `api.md`, `architecture.md`, `README`   |

No new dependency: Node 22 already ships `fetch` and `crypto` (PKCE, JWKS→PEM),
`jsonwebtoken` is already a backend dependency and `bcryptjs` already hashes
passwords.


## Environment contract

| Variable                 | Used by          | Default   | Description                                                                                  |
| ------------------------ | ---------------- | --------- | -------------------------------------------------------------------------------------------- |
| `AUTH_METHOD`            | backend          | `account` | `account` (form) or `keycloak` (SSO). Anything else falls back to `account`.                  |
| `ACCOUNT_LOGIN`          | backend          | _(none)_  | Comma-separated emails. The **first** one becomes the `owner`.                                |
| `ACCOUNT_PASSWORD`       | backend          | _(none)_  | Comma-separated passwords, positionally matched to `ACCOUNT_LOGIN`. A bcrypt hash is accepted as-is. |
| `ADMIN_PASSWORD`         | backend          | `admin`   | **Deprecated**: only used when `ACCOUNT_LOGIN` is unset and the method is `account`.          |
| `KEYCLOAK_BASE_URL`      | backend          | _(none)_  | Realm root, e.g. `https://sso.example.com` (no `/realms/...`).                                |
| `KEYCLOAK_REALM`         | backend          | _(none)_  | Realm name.                                                                                   |
| `KEYCLOAK_CLIENT_ID`     | backend          | _(none)_  | Confidential client used for the code exchange.                                               |
| `KEYCLOAK_CLIENT_SECRET` | backend          | _(none)_  | Client secret; omit for a public client with PKCE only.                                       |
| `KEYCLOAK_REDIRECT_URI`  | backend          | _(none)_  | Must be `<public origin>/api/auth/keycloak/callback`.                                         |
| `KEYCLOAK_RESTRICT`      | backend          | _(none)_  | Email allow-list: whole emails or bare domains (`example.com`).                               |
| `RECAPTCHA_CLIENTID`     | backend+frontend | _(none)_  | reCAPTCHA v2 site key; when set (with the secret) the login form shows the widget.            |
| `RECAPTCHA_CLIENTSECRET` | backend          | _(none)_  | reCAPTCHA v2 secret used by `siteverify`.                                                     |

`AUTH_METHOD` is environment-only and never a database setting: it decides which
routes exist at all, so it is surfaced to the UI through `GET /api/settings`
(`authMethod`, `recaptchaSiteKey`) and cannot be flipped by an admin request.

### Fail-fast rules (`utils/Requirements.ts`)

- `AUTH_METHOD=keycloak` without `KEYCLOAK_BASE_URL`, `KEYCLOAK_REALM`,
  `KEYCLOAK_CLIENT_ID` or `KEYCLOAK_REDIRECT_URI` → boot aborts.
- `AUTH_METHOD=keycloak` with an empty `KEYCLOAK_RESTRICT` **and** no
  `ACCOUNT_LOGIN` → boot aborts. Without either, the first SSO login would
  self-provision itself as the `owner`, so the instance would be wide open to
  anyone who can reach the provider.
- `ACCOUNT_LOGIN` without `ACCOUNT_PASSWORD` → warning; those accounts get a
  random password and cannot use the password form.
- `ACCOUNT_PASSWORD` without `ACCOUNT_LOGIN` → warning (ignored).


## Backend design

### `structures/auth.ts`

Pure configuration: no Prisma, no logging, no I/O. It exports `AUTH_METHOD`, the
allow-list check, `isValidEmail`, the Keycloak endpoint builder (derived from
`BASE_URL` + `REALM`, no `.well-known` round-trip at boot) and
`validateAuthConfiguration()` returning `{ errors, warnings }` for
`Requirements.ts` to act on. Values are unquoted and trimmed so the same `.env`
works with `dotenv`, `docker compose` and a plain `env` export.

### Local accounts

`ACCOUNT_PASSWORD` is compared in constant time (`crypto.timingSafeEqual`) when it
is a plaintext value, and through `bcrypt.compare` when it is already a `$2*$`
hash. `createAdminUserIfNotExists()` seeds **every** `ACCOUNT_LOGIN` entry the
first time it runs: the first one gets `owner` + `admin`, the rest get `user`, and
any entry without a password gets a random one (so the form can never be used
against it). The function returns early when an `owner` already exists, which is
how the previous `admin` user kept its password across upgrades.

### Keycloak flow (backend-owned)

The whole flow lives behind `/api/`, so nginx (which already proxies `/api/`)
carries the redirect and no frontend route, CORS rule or cookie policy changes:

1. `GET /api/auth/keycloak/login` mints `state` (32 random bytes), a `nonce` and a
   PKCE `code_verifier`, stores them in memory for 10 minutes and 302s to
   `<base>/realms/<realm>/protocol/openid-connect/auth` with an S256 challenge.
2. `GET /api/auth/keycloak/callback` consumes the `state` (single use), exchanges
   the code at `/token` (client secret included when configured), verifies the
   `id_token` — RS256 signature against the realm JWKS (cached 5 min), `iss`,
   `aud`/`azp` = client id, `exp` and the `nonce` — and refuses unverified emails.
3. The email must pass `KEYCLOAK_RESTRICT`; the user is then found (or
   just-in-time created with a random password) and the same `token` cookie the
   password login sets is returned, followed by a 302 to `/dashboard`.

Every failure redirects to `<redirect-uri origin>/login?error=<code>` instead of
returning JSON, because the callback is reached by a browser navigation and a raw
error body would be what the user sees. The redirect target is derived from
`KEYCLOAK_REDIRECT_URI`, so no separate variable is needed and dev/prod stay
consistent.

Only the **first** provisioned account (`ACCOUNT_LOGIN[0]`, or the first
allow-listed login when it is unset) receives `owner`; everyone else gets `user`,
which can be promoted from the admin panel afterwards.

Known limitation: `state`/PKCE live in a process-local `Map`, so the flow is
single-instance. The shipped deployment is one container (nginx + backend +
frontend), so this matches; a multi-replica deployment would need shared state.

## Frontend design

- `GET /api/settings` now returns `authMethod` and `recaptchaSiteKey`; both are
  added to the `Settings` type.
- `app/(auth)/login/page.tsx` renders `<KeycloakLoginButton />` when
  `settings.authMethod === 'keycloak'` and the password form otherwise, and shows
  the reason when it is reached with `?error=...` from the callback.
- `LoginForm` submits `email` (the `username` field stays as a deprecated alias in
  the API schema) and mounts the reCAPTCHA v2 checkbox when a site key is present.
- `RegisterForm` asks for an email; the register page and the account page hide
  registration/change-password under `keycloak`.

## Verification

- `yarn workspace @safestorage/backend lint` / `build` (tsc + alias rewrite).
- `yarn workspace @safestorage/next lint` / `typecheck` / `build`.
- No Prisma migration, so `prisma migrate deploy` is a no-op and existing
  `username` values keep working.
- Manual: boot with `AUTH_METHOD=account` + `ACCOUNT_LOGIN` and log in with the
  email; boot with `AUTH_METHOD=keycloak` and complete a round-trip against a
  disposable realm (allow-listed email signs in, non-allow-listed email is sent
  back to `/login?error=not_allowed`).

- `ACCOUNT_PASSWORD` without `ACCOUNT_LOGIN` → warning (ignored).
