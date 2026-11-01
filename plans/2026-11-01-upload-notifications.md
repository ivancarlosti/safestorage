# 2026-11-01 - Upload notifications

## Why

Uploads were silent: the only email the instance could send was the album share
invite. An instance owner had no way of knowing that a visitor dropped a file on
the dashboard, and the owner of an album with an upload-enabled public link had
to poll the album to notice new files.

Both notifications are opt-in, so an instance that upgrades keeps behaving
exactly as before.

## What changed

| Layer    | Change                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Database | `settings` gains `anonymousUploadNotificationsEnabled` (`false`)                                             |
| Database | `albums` gains `notifyOnPublicUpload` (`false`)                                                              |
| Backend  | New `utils/UploadNotifications.ts`: resolves the recipients and calls the mailer                             |
| Backend  | `utils/Mailer.ts` gains `sendUploadNotificationMail` (file details + file/preview/album links)               |
| Backend  | `files/Upload.ts` and `files/UploadProcess.ts` notify after the response (local uploads and network storage) |
| Backend  | `GetAlbums` returns `notifyOnPublicUpload`, `UpdateAlbum` accepts it                                         |
| Frontend | New **Anonymous Upload Notifications** switch in **Admin → Settings → Uploads**                              |
| Frontend | New **Notify on public uploads** switch in **Album settings**                                                |
| Docs     | `docs/configuration.md` documents the new setting and the per-album switch                                   |

## Recipients

| Upload                                               | Setting checked                       | Recipients                          |
| ---------------------------------------------------- | ------------------------------------- | ----------------------------------- |
| Signed out, no album (main dashboard / public mode)  | `anonymousUploadNotificationsEnabled` | Enabled users with the `owner` role |
| Through an album public link (any visitor)           | `albums.notifyOnPublicUpload`         | Album owner + all `albumMembers`    |
| Signed in, into an album (`target.type === 'album'`) | -                                     | Nobody                              |

`users.username` holds the email in `AUTH_METHOD=account`; accounts that are
disabled, have a non-email username (possible under keycloak) or are the
uploader itself are skipped and deduplicated.

## Delivery

`notifyUpload` is called after `res.send`, wrapped in `void`, and never throws.
`sendUploadNotificationMail` returns `{ sent, error }` per recipient, so one bad
address cannot block the others. Without SMTP configured the helper returns
before touching the database. The links are built with `instanceUrl`, falling
back to the `Origin` of the upload request and then to `getHost(req)`.

## Known limits

- Every stored file sends one email; there is no digest, batching or throttle.
- A link upload never notifies the instance owner: the album owners are the
  recipients of that flow.
- The switch is album-wide, not per link. It only makes a difference for links
  with **Allow uploads** enabled.
- Keycloak usernames that are not email addresses receive no notifications.
