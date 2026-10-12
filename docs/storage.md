# Storage

SafeStorage can keep uploads in two places, toggled with the **`useNetworkStorage`** setting (`Admin → Settings → Uploads`):

1. **Local disk** (default) — files are written under `/app/uploads` in the container.
2. **Network storage** — files go to any S3-compatible bucket (AWS S3, Backblaze B2, Cloudflare R2, Wasabi, MinIO, …).

## Local disk

| Folder               | Container path        | Contents                              |
| -------------------- | --------------------- | ------------------------------------- |
| live uploads         | `/app/uploads`        | the uploaded files themselves         |
| thumbnails           | `/app/uploads/thumbs` | generated previews                    |
| chunked uploads      | `/app/uploads/tmp`    | chunks of in-progress chunked uploads |
| generated archives   | `/app/uploads/zips`   | ZIP files built from public albums    |
| live/streaming video | `/app/uploads/live`   | streaming media                       |

nginx serves these straight off disk (Range requests included), so downloads do not go through Node. Back up `/app/uploads` along with the database; see [Deployment](deployment.md).

`serveUploadsFrom` (a full URL, e.g. `https://cdn.example.com`) tells SafeStorage which base URL to use when building public links to those files.

## Network (S3-compatible) storage

Enable **`useNetworkStorage`** and fill in the S3 settings. Once network storage is on, **all** uploads go to the bucket — chunked uploads to local disk are only used when it is disabled — so remember to raise **Max Size** here too.

| Setting       | Description                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------- |
| `S3Region`    | Bucket region.                                                                               |
| `S3Bucket`    | Bucket name.                                                                                 |
| `S3AccessKey` | Access key id.                                                                               |
| `S3SecretKey` | Secret access key.                                                                           |
| `S3Endpoint`  | Custom endpoint. **Leave empty for AWS S3**; required for R2/Wasabi/B2/MinIO.                |
| `S3PathStyle` | `true` for most non-AWS providers, `false` for AWS.                                          |
| `S3PublicUrl` | The full URL right before the filename, so links SafeStorage creates are publicly reachable. |

Because these providers all speak the S3 API, a little tuning of `Endpoint`, `PathStyle` and `PublicUrl` is usually all that is needed.

### How uploads work

Files go **straight from the browser to the bucket**, never through the backend:

-   files up to **100 MiB** use a single pre-signed `PUT`;
-   larger files use a real **S3 multipart upload** (2 parts at a time, failed parts retried, 12 h URL lifetime), so there is no 5 GB single-`PUT` ceiling.

The backend collects the ETags itself, so the bucket does **not** need `ExposeHeaders: ETag` in its CORS rules.

### Bucket policy

A good starting point for your bucket policy (**Bucket → Permissions → Bucket Policy**), so that generated file links are publicly readable:

```json
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "AddPerm",
			"Effect": "Allow",
			"Principal": "*",
			"Action": "s3:GetObject",
			"Resource": "arn:aws:s3:::safestorage-test/*"
		}
	]
}
```

Replace `safestorage-test` with your bucket name. Lock it down further if you need non-public files.

### Cross-origin resource sharing (CORS)

Direct browser-to-bucket uploads require CORS. A starter policy (**Bucket → Permissions → Cross-origin resource sharing**):

```json
[
	{
		"AllowedHeaders": ["*"],
		"AllowedMethods": ["PUT"],
		"AllowedOrigins": ["*"],
		"ExposeHeaders": []
	}
]
```

Tighten `AllowedOrigins` to your instance's domain. This is a starting point only — final CORS security is up to you and outside the scope of SafeStorage.

### Backblaze B2 CORS

Backblaze B2 uses a different rule structure. It is recommended to manage it with the [B2 CLI](https://www.backblaze.com/docs/cloud-storage-command-line-tools); see the [B2 CORS docs](https://www.backblaze.com/docs/cloud-storage-cross-origin-resource-sharing-rules).

```json
[
	{
		"corsRuleName": "safestorage",
		"allowedHeaders": ["*"],
		"allowedOperations": ["s3_put"],
		"allowedOrigins": ["*"],
		"exposeHeaders": [],
		"maxAgeSeconds": 3600
	}
]
```

Then apply it:

```bash
b2 update-bucket --corsRules "$(<./cors.json)" bucketName
```
