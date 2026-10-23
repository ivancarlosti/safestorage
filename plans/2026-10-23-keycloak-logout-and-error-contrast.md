# 2026-10-23 — Keycloak-aware logout and a readable login error

## Why

Two things went wrong together when a Keycloak deployment refused an email:

- The login page said **"This email is not allowed to sign in to this instance."**
  in `text-destructive`, which is `hsl(0 63% 31%)` — a dark red meant for solid
  buttons. On the `hsl(224 71% 4%)` background it has ~2:1 contrast, so the only
  explanation the user gets was almost unreadable.
- The message was also a dead end. The app has no local session at that point, but
  the provider's SSO session is very much alive, so clicking **Sign in with single
  sign-on** again landed on the same error with no way out. There was no logout
  button anywhere on that page, and the **Sign out** item in the user menu (and the
  drawer) only deleted the `token` cookie — the next SSO click signed the same
  account straight back in.

## What changed

| Layer    | Change                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Backend  | `utils/Keycloak.ts`: exported `getFrontendUrl()` (moved from `Callback.ts`) and new `createLogoutUrl()`        |
| Backend  | New `GET /api/auth/keycloak/logout`: clears the `token` cookie, then redirects to the provider's end-session   |
| Backend  | `Callback.ts` uses the shared `getFrontendUrl()`; the local copy and its env import are gone                   |
| Frontend | New `components/auth/KeycloakLogoutButton.tsx` (plain anchor, secondary button)                                |
| Frontend | `login` page: error box uses `text-red-300` on `bg-red-500/10`, and carries the logout button under Keycloak  |
| Frontend | `Header` → `Navigation`/`NavigationUser`/`NavigationDrawer` receive `authMethod`; **Sign out** uses the route  |
| Docs     | `configuration.md`, `api.md`, `troubleshooting.md`, `deployment.md`, `docker/README.md`, `docker/.env.example` |

## Backend design

`GET /api/auth/keycloak/logout` is deliberately **public**. The button exists
precisely for the state where the app has no session (a refused sign-in), while
the session that has to be ended belongs to the provider. It:

1. clears the `token` cookie (`path: '/'`, matching the way `Login.ts` and the
   callback set it) so the instance is logged out even if the provider is
   unreachable or `AUTH_METHOD` is not `keycloak`, then
2. redirects to `<issuer>/protocol/openid-connect/logout` with `client_id` and
   `post_logout_redirect_uri=<KEYCLOAK_REDIRECT_URI origin>/login`.

The public origin is derived from `KEYCLOAK_REDIRECT_URI` (the callback URL the
browser is already known to reach) instead of a new environment variable, and the
browser comes back to a clean `/login` — the `?error=` code is dropped by design.

No `id_token_hint` is sent: the id_token is only verified during the callback and
is never stored, so Keycloak shows its own "Do you want to log out?" confirmation
before ending the session. Keeping the id_token in an extra httpOnly cookie would
skip that page at the cost of storing a token in the browser and handling its
short lifetime; the confirmation is the standard behaviour and needs no state.

The client's **Valid post logout redirect URIs** must contain
`https://<your-domain>/login`. Without it Keycloak renders its own "Invalid
redirect URI" page instead of returning to the app; the documentation and the
troubleshooting guide call that out.

As with the login routes, the endpoint is rate limited (20/min) and a browser
navigation (GET), so a third-party link can log a user out. That is the normal
RP-initiated logout trade-off and is low impact.

## Frontend design

- `KeycloakLogoutButton` is a plain `<a href="/api/auth/keycloak/logout">`, not a
  `next/link`: the backend answers with a redirect to the provider, so the browser
  has to leave the app instead of letting the router prefetch the endpoint.
- The login page keeps the same alert position but wraps the text in a `<p>`
  inside a `flex flex-col gap-3` panel, and renders the button only when
  `authMethod === 'keycloak'`; on the account method the message stays a plain
  error.
- The header knows the method already (it fetches `/settings` on the server), so
  it passes `authMethod` down as a prop. Reading `settingsAtom` in the client
  components would work too, but the atom is filled asynchronously by
  `SettingsProvider`, and its initial `null` would render the local-only logout in
  the meantime.
- `lib/logout.ts` is untouched: the 401 handler in `UserProvider` still needs the
  local-only server action (there is no provider round-trip to make from a failed
  API call).

## Verification

- `yarn workspace @safestorage/backend build` and `lint`.
- `yarn workspace @safestorage/next typecheck` and `lint`.
- Manual: with `AUTH_METHOD=account`, `GET /api/auth/keycloak/logout` must clear
  the cookie and 302 to `/login`. A full round-trip needs a realm: a
  non-allow-listed email shows the readable error and the logout button, the
  provider confirms, and the browser lands on `/login`; **Sign out** in the user
  menu does the same.
