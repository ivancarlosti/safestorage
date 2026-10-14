# New brand icon (upload arrow in a rounded box)

**Status:** implemented
**Date:** 2026-10-14

## Goal

Replace the inherited chibisafe "bunker" illustration with a minimal, original
safestorage mark, and propagate it to **every** place the old icon appeared:
the inline React logo, the standalone master SVG, the Safari pinned tab and the
whole raster favicon set.

## Decision

The new mark is an **upload arrow inside a rounded square**, drawn flat with a
single accent colour:

- square `viewBox="0 0 128 128"` (the old art was a non-square `234x245`, but
  every consumer forces both a width and a height, so a square box scales
  cleanly from `w-6 h-6` up to `h-64 w-64`);
- rounded-square plate (`rx 26`) filled `#2563eb` (the app's blue accent —
  `blue-500` links, `#276ae9` dropzone), with a bold white up-arrow;
- self-contained plate → legible at 16px and readable on the dark UI
  (`--background: 224 71% 4%`) and on the `#030711` OG canvas.

Geometry (identical in all three source files):

- plate: `M33 7H95A26 26 0 0 1 121 33V95A26 26 0 0 1 95 121H33A26 26 0 0 1 7 95V33A26 26 0 0 1 33 7Z`
- arrow: `M59.9 34.38Q64 30 68.1 34.38L89.9 57.62Q94 62 88 62L81 62Q75 62 75 68L75 88Q75 94 69 94L59 94Q53 94 53 88L53 68Q53 62 47 62L40 62Q34 62 38.1 57.62Z`

## Changes

| File | Change |
| --- | --- |
| `packages/next/public/logo.svg` | replaced with the new master |
| `packages/next/src/components/svg/SafeStorageLogo.tsx` | `SafeStorageDefaultLogo` rewritten (`viewBox 0 0 128 128`); exports + `className`/`width`/`height` props kept |
| `packages/next/public/safari-pinned-tab.svg` | monochrome silhouette (`fill-rule="evenodd"` → arrow is a hole in the plate) |
| `packages/next/public/favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png`, `mstile-150x150.png`, `favicon.ico` | regenerated from the master |
| `packages/next/scripts/generate-icons.mjs` | new reproducible generator (`sharp` + a hand-rolled PNG-in-ICO writer) |
| `packages/next/package.json` | added the `icons` script |

Consumers mostly stayed untouched, because they import the component and the
raster files keep their names/sizes — so `layout.tsx`, `site.webmanifest` and
`browserconfig.xml` need no edits, and `Header.tsx`, `Footer.tsx`,
`(home)/page.tsx` and the auth pages only size the mark through `className`.
`app/og/route.tsx` was the exception: it had the *old* aspect ratio baked into
its boxes (`175px`/`184px`, plus the `234px`/`245px` component defaults), so both
are square now. `logo.svg` is not imported by any code — it stays as the public
master the raster set is generated from.

## Notes

- `sharp` (already a Next.js dependency) is the only image tool on the machine;
  it cannot emit `.ico`, so `generate-icons.mjs` assembles the ICO container
  (header + 16-byte directory entries + embedded PNGs) itself. No new
  dependency was added.
- Raster sizes are unchanged from before: 16/32, 180 (Apple), 192/512 (PWA),
  270 for `mstile-150x150.png` (the file was already 270×270), ICO 16/32/48.
- `app/og/route.tsx` carried the old aspect ratio in its boxes (`175px`/`184px`
  for the section variant and the `234px`/`245px` component defaults). Both are
  square now, and they match the boxes the admin-uploaded logo already used:
  `175px`/`175px` mirrors `w-44 h-44` and `208px`/`208px` mirrors `w-52 h-52`,
  so the OG card is the same size with or without a custom logo.
- Regenerate the rasters any time with
  `yarn workspace @safestorage/next icons`.
- Verified: `typecheck` and `lint` pass; rasterised pixels confirm the plate is
  `#2563eb`, the arrow white and the corners transparent.

## Follow-up: README screenshots

The 14 images in [`docs/screenshots`](../docs/screenshots) are generated, so they
still showed the old mark — and, because they had not been re-captured since
before the MariaDB switch, a stale SQLite-era `snippet.png`. All of them were
regenerated from an image built from this checkout:

```bash
docker build -t safestorage:local .
cd docs/screenshots
SAFESTORAGE_IMAGE=safestorage:local ./generate.sh
```

Beyond the mark itself this also picks up the MariaDB-era demo snippet, so the
committed set now matches the source. `api-docs.png` has no brand mark in it (the
Scalar page is served by the backend) and was regenerated like the rest.

The stale build output that still contained the old paths
(`packages/next/.next`, ~1 GB of regenerable chunks) was deleted; the tree no
longer holds a single copy of the old art.

