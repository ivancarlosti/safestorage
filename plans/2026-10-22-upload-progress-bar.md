# Make the upload progress bar actually show progress

**Status:** implemented
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

## Changes

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

## Notes / out of scope

-   `Statistics.tsx` still re-exports the Tremor charts. `ProgressCircle` paints
    its track with `opacity-20`, which Tailwind 4 still ships, so it is not
    affected by the removed `bg-opacity-*` scale.
-   The repository has no component test suite, so the visual check (header
    pill animating from 0 % while a large multipart upload runs) is manual.
-   Uploads waiting in `uploadQueue` are still not listed in the panel until
    `onStart` fires; only the ones actually transferring are counted.
