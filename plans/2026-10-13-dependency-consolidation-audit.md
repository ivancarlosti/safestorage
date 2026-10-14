# 2026-10-13 — Dependency audit: dead code, removable packages, and overlap consolidation

## Why

Every declared dependency across the root and the four workspaces (`backend`, `next`,
`uploader-client`, `uploader-module`) — 141 in total — was cross-referenced against actual
imports, including subpath imports, dynamic route loading, and indirect/peer usage. The goal was
to delete anything the code never reaches and to settle the packages that looked redundant.

## What changed

| Phase | Change |
| --- | --- |
| 1 | Deleted 10 dead source files; removed the 5 Radix packages they were the only consumers of |
| 2 | Replaced `@uidotdev/usehooks` with a local `useLongPress`; replaced `ffmpeg-probe` with `fluent-ffmpeg`'s built-in `ffprobe` |
| 3 | Declared `@react-types/shared` (was resolved through hoisting); corrected stale ESLint comments |
| 4 | Migrated `moment` → `new Date()`; documented the React Aria / Radix decision |

### Phase 1 — dead files and the Radix packages behind them

| File | Why it was dead |
| --- | --- |
| `packages/backend/src/utils/videoPreview/FragmentIntervalPreview.ts` | never imported (only `FragmentPreview` is) |
| `packages/next/src/components/ui/accordion.tsx` | no importer |
| `packages/next/src/components/ui/avatar.tsx` | no importer |
| `packages/next/src/components/ui/card.tsx` | no importer |
| `packages/next/src/components/ui/progress.tsx` | no importer |
| `packages/next/src/components/ui/toggle.tsx` | no importer |
| `packages/next/src/components/ui/navigation-menu.tsx` | no importer |
| `packages/next/src/components/mdx/Card.tsx` | no importer |
| `packages/next/src/components/svg/PatreonLogo.tsx` | no importer |
| `packages/next/src/components/svg/DiscordLogo.tsx` | no importer |

Each deleted `ui/*` wrapper was the sole importer of exactly one Radix package, so
`@radix-ui/react-accordion`, `-avatar`, `-navigation-menu`, `-progress`, and `-toggle` were
removed from `packages/next/package.json` (production deps 51 → 46).

### Phase 2 — overlapping packages

| Package | Disposition | Reason |
| --- | --- | --- |
| `@uidotdev/usehooks` | removed | only `useLongPress` was used (`Masonry.tsx`); ported into `src/hooks/useLongPress.ts` |
| `ffmpeg-probe` | removed | only `FragmentPreview.ts` used it; `fluent-ffmpeg` (already a dep) exposes `ffmpeg.ffprobe` against the same binary |
| `usehooks-ts` | kept | 8 files use `useCopyToClipboard`, `useMediaQuery`, `useLocalStorage`, `useEventListener` |

`ffmpeg-probe` also pulled `execa@0.10` into the tree; `fluent-ffmpeg`'s `ffprobe` wrapper lifts
`width`/`height` off the video stream so `FragmentPreview` keeps reading `info.format.duration`,
`info.width`, and `info.height` unchanged.

### Phase 3 — correctness

- `@react-types/shared` is imported by `Dropzone.tsx` and `AlbumDropzone.tsx` but was not declared;
  it only resolved because `react-aria-components` hoists it. Now pinned as `^3.37.0`.
- The ESLint configs carried comments claiming import order is handled by
  `@ianvs/prettier-plugin-sort-imports`, which is not installed. The comments now state that the
  frontend simply does not enforce import order.

### Phase 4a — `moment` → `new Date()`

All 11 usages were the identical expression `moment.utc().toDate()`, which is exactly
`new Date()` (a `Date` is an absolute instant with no time zone). Files changed: `CreateTag`,
`ChangePassword`, `Register`, `GenerateApiKey`, `CreateSnippet`, `ZipAlbum`,
`BulkRemoveFilesFromAlbum`, `CreateAlbum`, `BulkAddFilesToAlbum`, `CreateLink`, and `utils/File.ts`.
`moment` was removed from `packages/backend/package.json`.

### Phase 4b — React Aria vs Radix: decision

**Keep both libraries.** They are complementary, not redundant:

- `react-aria-components` provides the accessible **drag-and-drop dropzone** (`DropZone`),
  **file trigger** (`FileTrigger`), and the pressable `Button`/`Label`/`ProgressBar` that pair with
  them. Radix has no drop-zone or file-trigger primitive.
- Radix provides the shadcn-style primitives for overlays and form controls (dialog, popover,
  dropdown-menu, select, tabs, switch, tooltip, …).

Migrating either side would mean rewriting either the upload DnD layer or all 12 Radix wrappers,
with no functional gain and high regression risk, so the two are left as-is. The
`useLongPress` port above therefore deliberately does **not** reach for react-aria's internal
`useLongPress` (which lives in `react-aria`, an undeclared transitive dependency).

## Deliberately kept

| Package | Why it looks unused but is not |
| --- | --- |
| `react-dom` | React peer required by Next.js |
| `sharp` | runtime dependency of `next/image` |
| `immer` | peer of `jotai-immer` (used by `lib/atoms/uploads.ts`) |
| `@prisma/client` | referenced from generated code (`runtime/client`) |
| `better-sqlite3` | transitive driver of `@prisma/adapter-better-sqlite3` |
| `adm-zip` / `unzipit` | not fully redundant — one writes archives, the other reads them in bulk |
| `jotai-immer` + `immer` | single consumer but the established state pattern; not worth reworking |
| `@formkit/tempo` | frontend date formatting; distinct from the (now removed) backend `moment` |
