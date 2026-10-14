# 2026-10-13 — Drop the marketing homepage and the `useMinimalHomepage` flag

## Why

The public `/` route used to render two different designs behind a single boolean setting:
the full marketing landing page (hero, feature grid, call-to-action links) and a minimal
homepage that is just the logo, a welcome heading and the upload button. The instance ships
with the flag off, so every deployment still had to keep the marketing copy, its icons and
its link targets in sync with the product.

The minimal homepage is the design we actually want for a self-hosted file bunker — a
deployment should immediately offer the uploader instead of pitching itself. Keeping the
marketing variant around cost maintenance for a screen nobody enables, so this removes the
full page entirely and makes the minimal version the only rendering of `Home()`.

Removing the page left the setting that selected between the two dead weight: nothing read
it once the branch was gone, so the flag was deleted from the schema, the API, the admin
panel and the docs rather than left as a no-op.

## What changed

| Layer | Change |
| --- | --- |
| Frontend | `app/(home)/page.tsx` now only renders the onboarding/offline fallback and the minimal homepage |
| Frontend | `useMinimalHomepage` removed from the admin `SettingsForm` zod schema and the `Settings` type |
| Backend | Column dropped from the `settings` model and the `SETTINGS` structure |
| Backend | Flag removed from `GET /settings` response schema/payload and from the public `GET /setting/:setting` allow-list |
| Docs | Row removed from `docs/configuration.md`; `docs/screenshots/home.png` regenerated |
| Data | New migration `20261013120000_remove_use_minimal_homepage_flag` |

### `app/(home)/page.tsx`

The `if (settings?.useMinimalHomepage) { … } return (<full marketing page>)` construction
collapsed into a single unconditional `return`. Two behaviours are deliberately preserved:

- The **backend-unreachable fallback** (`if (!settings)`) still renders the logo with a
  "Could not establish a connection" message — it is what a visitor sees while the API is
  down, and it is not part of the marketing page.
- The **development-only `console.error(error)`** before that fallback is kept: the backend
  remains the place that logs the cause, and the browser console still gets a pointer in dev.

Pruning the full page also made these imports unreachable and they were removed:
`BlocksIcon`, `GalleryHorizontal`, `LinkIcon`, `TagsIcon`, `UsersRoundIcon`, `Link`
(`next/link`), `cn` and `buttonVariants`.

### Migration and rollback

The SQLite bundled with the image is 3.53.2, so the column can be dropped in place, and
Prisma applies migrations through `prisma migrate deploy` from `container/entrypoint.sh`
on every container start. Rollback is a one-liner:

```sql
ALTER TABLE "settings" ADD COLUMN "useMinimalHomepage" BOOLEAN NOT NULL DEFAULT false;
```

The original `20240322180510_add_use_minimal_homepage_flag` migration is intentionally left
in place: it is historical, and deleting it would break databases that have not yet run it.

## Verification

- `yarn workspace @safestorage/next typecheck` and `lint` (eslint + prettier) are clean.
- `yarn workspace @safestorage/backend build` and `lint` are clean.
- `yarn workspace @safestorage/backend migrate` applies the new migration: `PRAGMA
  table_info(settings)` reports 43 columns and no `useMinimalHomepage`.
- `grep -r useMinimalHomepage` over both packages, the docs and the README returns nothing.
