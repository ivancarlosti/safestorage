# 2026-11-01 - Remove the standalone Short URLs page

## Why

The YOURLS shortener creates links on an external instance and SafeStorage
stores nothing, so `/dashboard/links` could never list, resolve or delete them.
All it offered was a form that duplicates the **Create short URL** entry already
present in every file's Actions menu and in the file preview toolbar — one extra
sidebar item that only creates a link and then tells the user to copy it.

## What changed

| Layer     | Change                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | `app/dashboard/links/page.tsx` deleted; `/dashboard/links` no longer exists                                                                       |
| Frontend  | `DashboardSidebar` no longer renders the `useUrlShortener`-gated **Short URLs** item (and drops the `Link` icon import)                           |
| Docs      | README screenshot table reflowed without the Short URLs cell; `docs/screenshots/README.md` and `capture.mjs` no longer reference `short-urls.png` |
| Docs      | `docs/configuration.md` describes the shortener as a file action only                                                                             |
| Artefacts | `docs/screenshots/short-urls.png` removed and the remaining screenshots regenerated from a local image                                            |

## Behaviour

- The shortener itself is untouched: `CreateShortUrlDialog`,
  `CreateShortUrlDrawer`, `LinksActions`, `POST /api/link/create`,
  `utils/Shortener.ts` and the `useUrlShortener` / `yourlsApiUrl` /
  `yourlsSignature` settings all keep working.
- Links are created from the **Create short URL** entry of a file's
  **Actions** menu (dropdown on desktop, drawer on mobile) and from the file
  preview toolbar, with the file's public link already filled in.
- `/dashboard/links` answers 404. There is no redirect: the page only ever
  created links, so the file actions are the replacement.

## Known limits

- A bookmarked `/dashboard/links` URL now 404s.
- The uncontrolled `DialogTrigger` / `DrawerTrigger` in the dialog and drawer
  components have no caller left; they are kept as the components' default API.
