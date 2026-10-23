# Make the upload progress bar actually show progress

**Status:** implemented — a second round fixed the bar that was still invisible and the
chunked transfers that reported no progress at all (sections E–G below)
**Date:** 2026-10-22

## Goal

While a file is uploading, the progress bar in the header pill looked **full
from the first byte** and never moved, which is especially misleading when a big
file is sent over a slow connection.

## Root causes

### A. Tremor `ProgressBar` + Tailwind 4

`UploadProgress.tsx` rendered the overall bar with Tremor 3.18.7:

```tsx
<ProgressBar value={totalProgress} color="blue" className="max-w-sm w-80" />
```

Tremor hardcodes its track with a Tailwind **v3** utility:

```js
"relative flex items-center w-full rounded-tremor-full bg-opacity-20 h-2",
color ? "bg-blue-500" : "bg-tremor-brand-muted/50 …"
```

Tailwind 4 dropped the `bg-opacity-*` scale (`opacity` is applied through the
slash syntax now), and the repository migrated to Tailwind 4 in
`plans/2026-10-13-eslint-9-flat-config-and-tailwind-4.md`. Measured in this
checkout:

-   `grep -c bg-opacity node_modules/tailwindcss/dist/lib.js` → `0`
-   the generated stylesheet contained no `bg-opacity` rule at all, so the
    utility resolves to nothing,
-   `.bg-blue-500{background-color:var(--color-blue-500)}` is emitted fully
    opaque (v4 no longer routes the colour through `--tw-bg-opacity`).

Result: the track was painted in exactly the same solid `bg-blue-500` as the
fill, over the full width. The widget was a solid blue bar from byte one, so
the fill inside it could not be seen. `showAnimation` also defaults to `false`
in Tremor, so even a visible fill would have jumped instead of sliding.

### B. Overall progress included finished uploads

```ts
const counted = uploads.filter(file => file.status !== 'error');
setTotalProgress(counted.reduce((acc, file) => acc + file.progress, 0) / counted.length);
```

Every entry that had not failed was averaged, including the ones that completed
earlier and sit at `progress: 100` (the panel keeps them until "Clear all").
Starting a second upload therefore pushed the bar to 50 % or more before the
first byte of the new file was sent. The average also ignored file sizes, so a
tiny file at 100 % counted as much as a multi-gigabyte one at 10 %.

### C. Fill sized against the popover, not the track

The per-file bar used an absolutely positioned fill inside a track that had no
`relative`:

```tsx
<div className="h-2 … w-full rounded-full bg-white/40">
	<div className="absolute h-2 …" style={{ width: percentage + '%' }} />
</div>
```

The containing block was the Radix popover content (whose width differs from the
track once the scroll area takes its scrollbar), so the fill was wider than the
track. `percentage` is also `number | undefined` in `react-aria-components`;
`percentage + '%'` would have produced the invalid `width: "undefined%"`.

### D. Transfers finished below 100 %

`onFinish` marked a file as `success` without touching `progress`/`bytesSent`,
so the bar could stop a few percent short while the panel already said the
upload was complete.

### E. The bar was white on white (second round)

After the Tremor removal the header bar was drawn inside a `Button` whose variant
is `bg-primary`, i.e. `hsl(210 40% 98%)` — an almost white pill, with
`text-primary-foreground` (`hsl(222 47% 1%)`) as its text colour. Both halves of
the new bar were white:

| element | class      | against the button (`#f8fafc`) |
| ------- | ---------- | ----------------------------- |
| track   | `bg-white/40` | **1.02:1**                 |
| fill    | `bg-white`    | **1.05:1**                 |

Anything below ~1.3:1 is imperceptible, so the widget showed an empty pill no
matter what `totalProgress` was. That is why the report changed from "full blue
bar from the first byte" to "no bar at all, stuck at 0 %": the data was fine, the
paint was not. The per-file rows looked correct only because they sit on the dark
popover (`--popover: 224 71% 4%`), where white has plenty of contrast.

### F. `fetch` cannot report upload progress (second round)

The vendored client (`packages/uploader-client/src/index.ts`) used two different
transports:

```ts
if (uploader.totalChunks === 1) {
	// XMLHttpRequest + xhr.upload "progress"  ✅
} else {
	return fetch(endpoint, { method, headers, body: form });  // ❌
}
```

A `fetch` request body is not observable, so a chunked upload emitted a single
`onProgress((100 / totalChunks) * index)` **after** each chunk finished. The
running instance has `chunkSize = 81,000,000` (see `settings` in its database),
so a 90 MB file sat at 0 %, then jumped to 50 %, then finished — and every file
under 81 MB never showed a partially filled bar at all.

### G. The pill was shorter than its content (second round)

The triggering `Button` uses `size="default"` → `h-10`, and the uploading state
added `py-8`. 40 px of fixed height minus 64 px of vertical padding leaves the
bar and the labels overflowing the button, where the header can clip them.

## Changes (first round)

### `packages/next/src/components/UploadProgress.tsx`

-   Removed the `@tremor/react` `ProgressBar` import (Tremor stays only for the
    charts re-exported by `Statistics.tsx`).
-   Added a local `ProgressTrack` presentational component: a `relative`,
    `overflow-hidden`, `bg-white/40` track and an in-flow fill with
    `transition-[width] duration-300 ease-out`. The width is clamped to
    0–100 and `percentage ?? 0` covers the indeterminate case. The fill colour
    is a prop (`bg-white` normally, `bg-red-500` for failed uploads).
-   The header bar now uses the React Aria `ProgressBar` that was already
    imported for the per-file rows, so the value is exposed as
    `role="progressbar"` with `aria-valuenow` instead of a purely visual div:

    ```tsx
    <ReactAriaProgressBar value={totalProgress} aria-label="Overall upload progress" className="max-w-sm w-80">
    	{({ percentage }) => <ProgressTrack fillClassName="bg-white" percentage={percentage} />}
    </ReactAriaProgressBar>
    ```

-   `totalProgress` is now the byte-weighted progress of the uploads still
    `processing`, so completed/failed entries no longer inflate it:

    ```ts
    const inFlight = uploads.filter(file => file.processing);
    const bytesTotal = inFlight.reduce((acc, file) => acc + file.bytesTotal, 0);
    const bytesProgress = inFlight.reduce((acc, file) => acc + file.progress * file.bytesTotal, 0);
    setTotalProgress(bytesTotal === 0 ? 0 : Math.min(100, bytesProgress / bytesTotal));
    ```

-   The per-file row renders the same `ProgressTrack`, which gives it the
    animated width and fixes the mis-anchored absolute fill.

### `packages/next/src/hooks/useUploadFile.ts`

-   The three success paths now finish the bar at 100 %:
    -   multipart: after `/api/upload/multipart/complete` + processing,
    -   network storage single `PUT`: in `onFinish`,
    -   local uploads: in `onFinish`.
    Each sets `progress = 100` and `bytesSent = file.size` (multipart and
    network storage only when processing reported no error).
-   The uploader-client `onProgress` callback is typed as
    `(uuid: string, progress: number)` instead of `any`, and keeps `bytesSent`
    in sync (`Math.round((progress / 100) * file.size)`) so both upload paths
    expose consistent data.

## Changes (second round)

### `packages/next/src/components/UploadProgress.tsx`

-   `ProgressTrack` gained a `trackClassName` prop and spreads the remaining
    `div` props. It stays presentational — the header passes
    `role="progressbar"` with `aria-valuemin/max/now/valuetext`, while the
    per-file rows keep React Aria's element as the only progressbar so a screen
    reader does not announce the same upload twice.
-   The header bar is now blue on a light track instead of white on white:
    `fillClassName="bg-blue-600"` (4.9:1 against the button) and
    `trackClassName="bg-blue-600/20"` (1.3:1, visible as a trough). The track
    gets `animate-pulse` while `totalProgress` is 0, so the pill reads as "waiting
    for the first bytes" instead of "dead".
-   The pill shows the figure it is drawing — `Uploading N files 42%` on one row,
    the bar below it and `1.2 MB of 20 MB` (via `formatBytes`) underneath — so a
    short bar can no longer be mistaken for no progress. `Preparing upload…`
    replaces the byte count while the sizes are still unknown.
-   Layout: `h-auto min-h-10 px-3 py-1.5` replaces the `py-8` that overflowed the
    size variant's fixed `h-10` (`cn` is `twMerge`, so `h-auto`/`min-h-10` win
    deterministically). `gap-1` and `leading-none` on the byte row keep the pill at
    ~55 px, inside the 64 px (`h-16`) header row, and the bar is `w-56 sm:w-72`
    instead of the React Aria `w-80`.
-   `totalProgress` and the byte counts are `useMemo` over the atom instead of
    `useState` filled by an effect: no extra render per progress event and no
    frame where the bar lags behind the value the uploader just reported. The
    effect now only maintains `status`/`buttonText` and the query invalidation
    timer. The aggregation was rewritten with `for…of` loops because
    `unicorn/no-array-reduce` rejects `reduce` in this codebase.
-   The per-file rows keep React Aria (for `valueText`) and pass an explicit
    `trackClassName`, so the dark popover keeps the readable white/25 track.

### `packages/uploader-client/src/index.ts`

-   The chunked branch no longer uses `fetch`. It sends the same `FormData` with
    an `XMLHttpRequest` and reports `xhr.upload` progress as bytes:
    `Math.min(file.size, (index - 1) * chunkSize + event.loaded) / file.size`.
-   One `reportProgress` helper keeps the percentage monotonic (chunks are sent
    in parallel and a retried chunk restarts at 0) and de-duplicates events.
-   The per-chunk `(100 / totalChunks) * index` report is kept as a floor for the
    case where the browser stops the upload progress events just short of the
    chunk boundary.
-   The XHR resolves a real `Response` so the existing status handling
    (`200/201/204`, retry on `408/502/503/504`, `413` message parsing, JSON URL on
    the last chunk) is unchanged. Null-body statuses (`101/204/205/304`) are
    resolved without a body because `new Response` rejects one, and an
    unrepresentable status (0) rejects instead of leaving the promise pending.
-   `packages/uploader-client/lib` was rebuilt with
    `yarn workspace @safestorage/uploader-client build`; the frontend imports that
    build artifact (`main: lib/index.js`), so the source change alone would not
    have reached the app.

## Verification

Automated (run here):

1. `yarn workspace @safestorage/next typecheck` — clean.
2. `yarn workspace @safestorage/next lint` — clean.
3. `node node_modules/prettier/bin/prettier.cjs --check` on both touched files —
   clean.
4. `yarn workspace @safestorage/next build` — `✓ Compiled successfully`,
   `EXIT:0`.
5. The regenerated stylesheet
   (`packages/next/.next/static/css/cae9b507d0c17f6b.css`) contains
   `.bg-white\/40{…}`, `.overflow-hidden{…}`,
   `.transition-\[width\]{transition-property:width;…}`, `.duration-300{…}` and
   `.ease-out{…}`, and **zero** `bg-opacity` rules, i.e. nothing on the bar
   depends on the removed v3 utility any more.
6. A `react-dom/server` harness rendering `react-aria-components`' `ProgressBar`
   with `value={32.5}` returns
   `role="progressbar" aria-valuenow="32.5" aria-valuemin="0" aria-valuemax="100" aria-valuetext="33%"`,
   and the render prop receives `percentage = 32.5`, so the fill is sized to the
   real value.

### Second round

Automated (run here):

1. `yarn workspace @safestorage/uploader-client build` — rebuilt `lib/index.js`;
   the bundle no longer contains a `fetch(` call and now has three
   `upload.addEventListener` handlers.
2. A Node harness with a stubbed `XMLHttpRequest`
   (`/tmp/uploader-progress.test.mjs`) uploads a 300 B file in 3 chunks of 100 B
   and asserts the emitted percentages. Before the change the same scenario
   emitted `33, 66, 100`; now it emits
   `3, 13, 23, 32, 33, 37, 47, 57, 65, 67, 70, 80, 90, 98, 100` — strictly
   increasing, with five events per chunk in flight — and still finishes with the
   server's `url`. The single-request path emits `10, 40, 70, 95, 100`. All 7
   assertions pass.
3. `yarn workspace @safestorage/next typecheck` — clean.
4. `eslint src/components/UploadProgress.tsx` — clean (after replacing the
   `reduce` aggregation, which the flat config's `unicorn/no-array-reduce` flags).
5. `prettier --check src/components/UploadProgress.tsx` — clean.
6. `yarn workspace @safestorage/next build` — `exit=0`, and the stylesheet now
   contains `.bg-blue-600`, `.bg-blue-600\/20`, `.bg-white\/25`, `.min-h-10`,
   `.tabular-nums` and `.animate-pulse`; the new uploader code is in
   `static/chunks/3704-*.js`.
7. The image that serves :24424 predated this work, so the container was rebuilt
   (`docker build -t ghcr.io/ivancarlosti/safestorage:local .`) — the old
   container had been created at 19:52 local, three hours before the first
   round's commit.

Manual check (needs a browser, the repository has no component test suite):

1. Upload a file larger than the configured **Chunk Size** (set it to ~4 MB in
   *Admin → Settings* to try it with a small file).
2. Expected: the pill turns blue, the percentage climbs while the bytes are on
   the wire, the byte counter follows, and "All uploads complete 🎉" only appears
   after the last chunk.

## Notes / out of scope

-   `Statistics.tsx` still re-exports the Tremor charts. `ProgressCircle` paints
    its track with `opacity-20`, which Tailwind 4 still ships, so it is not
    affected by the removed `bg-opacity-*` scale.
-   The repository has no component test suite, so the visual check (header
    pill animating from 0 % while a large multipart upload runs) is manual.
-   Uploads waiting in `uploadQueue` are still not listed in the panel until
    `onStart` fires; only the ones actually transferring are counted.
