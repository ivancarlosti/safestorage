# 2026-10-31 - Album sharing between users

## Why

Albums were single-owner: `albums.userId` was checked on every route, so the only
way to give someone else access was a public link, which exposes the album to the
whole internet. Two accounts on the same instance could not collaborate on an
album at all.

Two related paper cuts went in the same pass:

- Long filenames and album names blew up their table columns: the `inline-flex`
  anchors of `FilesTable` never shrink, so `overflow-wrap` on the anchor could not
  reach the text (the anonymous flex item ignores it).
- The dashboard container was capped at `1400px`, which left a lot of empty space
  on large screens once the tables grew wider.

Invites were also dead weight under `AUTH_METHOD=keycloak`: `routes/auth/Register.ts`
answers `403` before it looks at the code, so an album invite would onboard nobody.

## What changed

| Layer    | Change                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Database | New `albumMembers` table (`albumId`, `userId`, unique pair, both FKs `ON DELETE CASCADE`)                   |
| Database | `invites` gains `email` and `albumId` (nullable, so admin invites are untouched)                            |
| Database | `settings` gains `instanceUrl` and the `smtp*` columns                                                      |
| Backend  | New `utils/AlbumAccess.ts`: `albumAccessWhere`, `albumOwnerWhere`, `getAlbumAccess`, `fileAccessWhere`        |
| Backend  | New `POST /api/album/:uuid/share`, `GET /api/album/:uuid/members`, `DELETE /api/album/:uuid/member/:userUuid`, `DELETE /api/album/:uuid/invite/:code` |
| Backend  | New `utils/Mailer.ts` (nodemailer, transport cached per settings signature, best-effort sends)               |
| Backend  | New `POST /api/admin/service/settings/test-email`, sends to the logged in admin                              |
| Backend  | `GetAlbum`, `GetAlbums`, `BulkZipAlbumFiles`, `BulkAddFilesToAlbum`, `BulkRemoveFilesFromAlbum`, `AddFileToAlbum`, `DeleteFileFromAlbum`, `GetFile`, `validateUploadTarget` use the access helpers |
| Backend  | `PurgeAlbum` only deletes the files uploaded by the owner                                                    |
| Backend  | `Register` consumes `email`/`albumId` from the invite and joins the album                                    |
| Frontend | New `AlbumShareDialog`, wired to the album page (owner only)                                                  |
| Frontend | `Album` tile hides **Settings** for members and shows who shared the album                                    |
| Frontend | Sidebar hides **Invites** under keycloak, the invites page redirects to `/dashboard`                          |
| Frontend | Settings gets an **Email** tab (instance URL + SMTP), with a test button                                      |
| Frontend | `break-all` on the filename/original/album cells; container `1800px` above `1400px`                           |

## Access model

| Action                                     | Owner | Member |
| ------------------------------------------ | ----- | ------ |
| Read the album and its files               | yes   | yes    |
| Upload into the album                      | yes   | yes    |
| Add / remove **own** files                 | yes   | yes    |
| Add / remove other people's files          | yes   | no     |
| Rename, delete, purge, manage public links | yes   | no     |
| Share with somebody else                   | yes   | no     |

Membership adds a second arm to every album query: `OR: [{ userId }, { members: { some: { userId } } }]`.
Files keep their owner (`files.userId`) and are reachable through an album the
user is a member of, which is what `fileAccessWhere` expresses.

## Sharing flow

`POST /album/:uuid/share` resolves the email in three ways:

1. **Existing account** - upsert `albumMembers`, notify by email, answer `type: "member"`.
2. **`AUTH_METHOD=account`, unknown email** - reuse the pending invite for that
   album/email or create one (`uuid` code, `email`, `albumId`), answer
   `type: "invite"` with `code` and `/invite/<code>`. `Register` then checks the
   email the invite was created for, creates the account and joins the album.
3. **`AUTH_METHOD=keycloak`, unknown email** - invites cannot be redeemed there, so
   the row is provisioned immediately: random password hash (the password form is
   never enabled), `user` role, plus the membership. The next SSO login matches the
   email and lands in the album. `KEYCLOAK_RESTRICT` is enforced, otherwise the
   call is refused with the allowed domains in the message.

## Email

SMTP is configured in **Admin → Settings → Email**, stored in the `settings` row
and read through `SETTINGS`, so no new environment variable is needed. Sending is
best-effort: `sendAlbumShareMail` returns `{ sent, error }`, the endpoint always
answers `200` with `emailSent: false` when the transport fails, and the invite
link is always returned so the owner can copy it. Emails never carry an absolute
URL that the instance cannot know: `instanceUrl` wins, the `Origin` of the request
is the fallback, and without either the message carries the code only.

## Known limits

- A member's files stay in the album when the membership is removed; the owner can
  remove those files through the file actions, the member keeps them in their own
  uploads (they were never transferred).
- Members can not see who else has access to the album (`/album/:uuid/members` is
  owner only) and can not reshare it.
- `GetFile`/`HighlightFile` widen file reads; `DownloadFile` and the static
  `/uploads` handler keep working by filename alone and were not touched.
