# New brand icon (upload arrow over a storage tray)

**Status:** implemented
**Date:** 2026-10-14 (revised the same day)

## Goal

Replace the inherited chibisafe "bunker" illustration with an original
safestorage mark, and propagate it to **every** place the old icon appeared:
the inline React logo, the standalone master SVG, the Safari pinned tab and the
whole raster favicon set.

## Decision

The mark is an **upload arrow over a storage tray on a rounded-square plate**,
drawn flat, with every corner rounded so it survives 16px:

- square `viewBox="0 0 128 128"` (the old art was a non-square `234x245`, but
  every consumer forces both a width and a height, so a square box scales
  cleanly from `w-6 h-6` up to `h-64 w-64`);
- plate: rounded square (`rx 26`) filled with a `blue-500 → blue-700` gradient
  (`#3b82f6` top-left → `#1d4ed8` bottom-right, the app's `blue-600` `#2563eb`
  in the middle). The gradient is what keeps the plate from reading as a flat
  swatch on the dark UI (`--background: 224 71% 4%`) and on the `#030711` OG
  canvas;
- white arrow — 66-wide head at `y=52`, 24-wide stem down to `y=76`, corners
  rounded `2.5` — above a white tray pill (54 x 16, `y=90`) 14 units below it.
  The tray adds the *storage* half of the name; 14 units ≈ 1.8px at 16px, so the
  two shapes never fuse.

### Geometry

Three paths, identical in the master SVG and the React component (all arcs are
real geometry — no stroke trickery — so the monochrome Safari mask can reuse
them verbatim):

- plate (unchanged from the first iteration):
  `M33 7H95A26 26 0 0 1 121 33V95A26 26 0 0 1 95 121H33A26 26 0 0 1 7 95V33A26 26 0 0 1 33 7Z`
- arrow:
  `M65.74 21.69L92.57 47.71A2.5 2.5 0 0 1 90.83 52L78.5 52A2.5 2.5 0 0 0 76 54.5L76 73.5A2.5 2.5 0 0 1 73.5 76L54.5 76A2.5 2.5 0 0 1 52 73.5L52 54.5A2.5 2.5 0 0 0 49.5 52L37.17 52A2.5 2.5 0 0 1 35.43 47.71L62.26 21.69A2.5 2.5 0 0 1 65.74 21.69Z`
- tray:
  `M45 90L83 90A8 8 0 0 1 91 98A8 8 0 0 1 83 106L45 106A8 8 0 0 1 37 98A8 8 0 0 1 45 90Z`

The arrow's two inside corners (where the stem meets the head) are *reflex*
vertices: their fillets use the arc sweep flag `0` and the reflex angle, not the
convex formula — getting that wrong bulges the stem outward.

### Why this shape (versions that were rendered and rejected)

Every candidate was rendered at 16/32/64/128 px on dark and light before
choosing:

| Candidate | Verdict |
| --- | --- |
| arrow only (the first iteration) | too plain — this is the revision's starting point |
| **arrow + tray pill + gradient** | **shipped**: crisp at 16px, keeps the brand blue |
| arrow into an open box (12-wide walls) | walls (1.5px at 16px) smear into the arrow |
| shield with the arrow cut out of it | good at ≥32px, but at 16px the white shield outweighs the blue identity |
| two-tone plate ("vault" frame) | reads as the framed-button cliché |
| glossy bevel, two shelves | dated; the shelves merge at 16px |

## Changes

| File | Change |
| --- | --- |
| `packages/next/public/logo.svg` | replaced with the new master |
| `packages/next/src/components/svg/SafeStorageLogo.tsx` | `SafeStorageDefaultLogo` rewritten (`viewBox 0 0 128 128`, plate gradient in a `<defs>`); exports + `className`/`width`/`height` props kept |
| `packages/next/public/safari-pinned-tab.svg` | monochrome silhouette (`fill-rule="evenodd"` → arrow *and* tray are holes in the plate) |
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
- The component's gradient lives in a `<defs>` with a fixed id. Every instance
  defines the identical gradient, so a page with several marks (header + footer)
  resolves the duplicate id to the same paint.
- `next/og` was checked separately before committing to a gradient: Satori/resvg
  renders the `<defs><linearGradient>` fill correctly (sampled `#1d4ed8` at the
  plate's dark end, white tray), so the OG card is unaffected.
- Verified: `typecheck` and `lint` pass; `prettier --check` passes on the
  component. Rasterised pixels of the committed files: plate `#377bf2` top-left →
  `#1d4ed8` bottom-right, arrow and tray white, corners transparent, `.ico` still
  holds 16/32/48.

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

## Revision: richer mark

The first mark (a lone arrow) read as too plain, so the artwork documented above
replaced it. The README set therefore shows a mark that no longer exists, and the
13 captures that contain it were regenerated once more from a rebuilt image:

```bash
docker build -t safestorage:local .
cd docs/screenshots
SAFESTORAGE_IMAGE=safestorage:local ./generate.sh
```

`api-docs.png` is the only capture without a mark in it (the Scalar page is served
by the backend), so it was regenerated along with the rest but changes nothing.

