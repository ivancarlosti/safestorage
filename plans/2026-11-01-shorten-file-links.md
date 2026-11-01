# 2026-11-01 - Short URLs from the file Actions menu

## Why

The YOURLS shortener was only reachable from `/dashboard/links`, where the
destination has to be typed or pasted by hand. Shortening the link to a file
meant opening the file, copying its link, switching to the short-URL page and
pasting it back — for the most common case of all.

## What changed

| Layer    | Change                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | `CreateShortUrlDialog` and `CreateShortUrlDrawer` accept `defaultUrl`, `open` and `onOpenChange`; the trigger button only renders when uncontrolled |
| Frontend | `FileInformationDialogActions` gains a **Create short URL** entry after **Copy link** (dropdown on desktop, drawer on mobile)                       |
| Frontend | `FileDialogToolbar` gains a **Create short URL** icon button (`Link2Icon`) after **Copy link**                                                      |
| Docs     | `docs/configuration.md` (Shortener) and the README feature list mention the new entry point                                                         |

`/dashboard/links` keeps working unchanged: without `open` the components own
their state and render the **Create short URL** button as before.

## Behaviour

- The form opens with the file's public link (`file.url`) already filled in as
  the destination; the prefill is applied on every open, because `DialogContent`
  and `DrawerContent` unmount when closed.
- The entry is only rendered while `settings.useUrlShortener` is on. The flag
  comes from the public `GET /api/settings` response and is read through
  `settingsAtom`, which `SettingsProvider` fills in the root layout.
- The parent owns the open state (`isShortenOpen`). A `DropdownMenuItem` closes
  its menu on select, and Radix unmounts the menu content with it, so the
  dialog/drawer is rendered as a sibling of the menu instead of inside a
  trigger.
- On mobile the Actions drawer is controlled and closes before the short-URL
  drawer opens: two stacked vaul drawers overlap their overlays.
- In the lightbox the **dialog** variant is used on every viewport, because the
  lightbox is itself a modal dialog. Radix's layer stack keeps the lightbox from
  dismissing when the nested dialog is clicked into, and the nested content is
  portalled to `document.body`, so it paints above the lightbox and above the
  toolbar's `z-[60]`.
- `FileDialog`'s window-level `ArrowLeft`/`ArrowRight` navigation ignores key
  events coming from inside a `<form>`, so the arrow keys edit the destination
  instead of flipping through the gallery.

## Known limits

- The destination is `file.url`, i.e. the link built from `serveUploadsFrom`
  (or, when that is empty, from the host of the request). A _relative_
  `serveUploadsFrom` makes YOURLS answer `400`: the setting is documented as a
  full URL.
- The entry is hidden for `type === 'publicAlbum'` (the page has no session, so
  `getToken()` would redirect to `/`) and for quarantined files (they are only
  reachable once they have been allowed).
- Nothing is stored locally: the dashboard still cannot list, resolve or delete
  the links, so the result view and its copy button are the only way to keep one.
- Only single files are covered. Shortening an album's public share link is
  still a manual copy/paste on `/dashboard/links`.
