# 2026-11-01 - Answer YOURLS by its JSON body, not by its HTTP status

## Why

Creating a short URL failed even when YOURLS had created it:

```
ERROR (58): Unexpected answer from the YOURLS instance:
{"status":"success", ..., "url":{"keyword":"adasda", ...}, "shorturl":"https://icc.gg/adasda"}
INFO (58): POST /api/link/create 502
```

The parser in `utils/Shortener.ts` required a top level `keyword`, but
`yourls_add_new_link()` never sends one: the keyword only lives in
`url.keyword` (true for 1.7.1, 1.9.2, 1.10.0 and master), and `shorturl` is the
only top level link field.

The same file turned every refusal into "The YOURLS instance answered with
HTTP 409/400". `yourls_api_output()` copies `statusCode` (falling back to
`errorCode`) into the HTTP status of the answer, so the two failures a user can
act on arrive as non-2xx responses **that still carry a usable JSON body**:

| `code`          | YOURLS status                          | Body                                        |
| --------------- | -------------------------------------- | ------------------------------------------- |
| `error:url`     | 200 (1.7.1), 400 (1.9.2/1.10.0), 409 (master) | existing `shorturl` + `url.keyword`  |
| `error:keyword` | 200 (1.7.1), 400 (1.9.2+)              | message, no keyword                         |
| `error:nourl` / `error:noloop` | 200 (1.7.1), 400 (1.9.2+) | message                            |
| `error:db` / `error:concurrency` | 500 / 503                            | message                                     |

Checking `response.ok` first threw all of that away, which is why a duplicate
destination and a taken custom URL both surfaced as `502`.

## What changed

| Layer    | Change                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------ |
| Backend  | `utils/Shortener.ts` parses the JSON body first; `response.ok` is only used for answers that are not YOURLS JSON |
| Backend  | Success schema accepts the real shape (`shorturl` top level, keyword in `url.keyword`) and derives `identifier` from `url.keyword` → `keyword` → last path segment of `shorturl` |
| Backend  | Failure mapping is driven by `code`: `error:url` and `error:keyword` → `409`, `error:nourl`/`error:noloop` → `400`, everything else → `502` with the YOURLS message |
| Frontend | The `CreateShortUrlDialog` / `CreateShortUrlDrawer` callout no longer promises a silent random fallback for a taken custom URL |
| Docs     | `api.md`, `troubleshooting.md` and `configuration.md` document the real `400`/`409` split |

## Behaviour

- A successful creation returns `link.identifier` again, so `POST /api/link/create`
  answers `200` with the short URL instead of `502`.
- Re-shortening the same destination answers `409` with
  `This URL has already been shortened on the YOURLS instance: <shorturl>`; the
  existing short URL comes from the failure body.
- A taken or reserved custom URL answers `409` with
  `The custom URL "<keyword>" is already taken on the YOURLS instance. Pick
  another one or leave the field empty to get a random one.` — the keyword comes
  from the request, because YOURLS does not echo it.
- Everything is logged server side with the YOURLS `code` and message; the API
  message is the friendly version.

## Known limits

- Nothing is retried: a taken custom URL is reported, not replaced by a random
  keyword, so the user decides whether the custom URL matters.
- `YOURLS_UNIQUE_URLS` turned off (duplicate destinations allowed) simply never
  produces `error:url`; the code path stays harmless.
- A destination that is itself a short URL of the same instance is a `400`
  (`error:noloop`), not a `409`.
