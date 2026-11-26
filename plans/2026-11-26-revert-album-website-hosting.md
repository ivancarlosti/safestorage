# Revert album static website hosting (back to v8.0.3)

## Context

On 2026-11-26 three commits shipped opt-in static website hosting for albums:

| Commit    | Subject                                                                    | Tag      |
| --------- | -------------------------------------------------------------------------- | -------- |
| `21db488` | feat(album): add opt-in static website hosting for albums                   | `v8.1.0` |
| `01a27f7` | fix(settings): include static website hosting fields in admin form schema   | `v8.1.1` |
| `f9d14a2` | feat(album): provision a dedicated `site/{identifier}/` folder for websites | `v8.2.0` |

In practice the feature did not deliver the expected result: it added a second
storage layout (`site/{identifier}/`), a separate static server, new settings,
new public routes and a large upload-path refactor, while the behaviour it
provided was not worth the extra surface area and complexity.

## Goal

Restore the `main` branch content to exactly the `v8.0.3` tree (`f56bb6a`),
keeping the published tags and history intact (no force-push).

## Steps

1. Revert the three commits, newest first, in a single rollback commit:

   ```sh
   git revert --no-commit f9d14a2 01a27f7 21db488
   git diff --cached --quiet v8.0.3 && echo "tree identical to v8.0.3"
   git commit -m "revert: roll back album website hosting to v8.0.3"
   ```

2. Verify nothing from the feature survives: no `packages/backend/src/utils/AlbumWebsite*`,
   `Website*` helpers, `routes/album/hosting/*`, no `docker/docker-compose-sites.yml`,
   no `2026112*_album_website*` migrations, no website fields in `schema.prisma`.

3. Run the backend tests/lint and the workspace build to confirm the reverted tree
   compiles and passes.
4. Push the rollback commit to `main`.

## Verification

- `git diff --cached --quiet v8.0.3` right after the reverts → tree identical to
  `v8.0.3` (`f56bb6a`). The rollback commit only adds this plan on top.
- `yarn workspace @safestorage/backend test` → 6 tests, 6 pass, 0 fail.
- `yarn workspace @safestorage/backend lint` → Prettier clean, ESLint clean.
- `yarn workspace @safestorage/next lint` and `typecheck` → clean.
- `yarn workspace @safestorage/backend build` → exit 0.
- `yarn workspace @safestorage/next build` → production build completes.
- Migration drift: a scratch database that already ran both removed migrations
  was created, then `prisma migrate deploy` was run from the reverted tree —
  exit 0, "No pending migrations to apply". Every column the migrations added is
  nullable or has a default (`isWebsite`/`serveWebsite`/`websiteHostingEnabled`
  default `false`, `websiteHostingDomain` default `''`, `sitePath` and
  `identifier` nullable), and `files.name` was only widened, so the reverted
  code keeps reading and writing that schema.

## Risks

- **Database drift.** The `20261126000000_album_website_hosting` and
  `20261127000000_album_website_site_folder` migrations are removed from the
  repository. Any environment that already applied them keeps the extra
  `Album`/`Links`/`Files`/`Settings` columns. They are nullable/defaulted and
  simply unused by `v8.0.3` code, so reads, writes and `migrate deploy` keep
  working (verified above); a follow-up migration is only needed if the columns
  must be dropped.
- **Public URLs.** Album website routes (`/a/{identifier}/…` static serving,
  settings, custom domain fields) disappear, so any client relying on them sees
  a 404 again — this is the intended behaviour.
- **Uploads stored under `site/{identifier}/`.** Files uploaded while `v8.2.0`
  was deployed in that layout are not visible to `v8.0.3`, which reads the
  classic `live/` layout. Move/merge those folders manually before rolling back
  a production instance that accepted website uploads.
- **Published images.** `ghcr.io/ivancarlosti/safestorage:latest` still points at
  `v8.2.0` until a new release is cut or deployments pin `SAFESTORAGE_TAG=v8.0.3`.
- **History.** The reverted commits (and their plans) stay reachable through the
  `v8.1.0`, `v8.1.1` and `v8.2.0` tags.
