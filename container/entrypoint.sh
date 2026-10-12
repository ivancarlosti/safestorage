#!/bin/sh
# SafeStorage combined container entrypoint.
#
# Prepares the writable folders, applies the Prisma migrations and then hands
# over to the process manager (supervisord) which starts the backend, the
# frontend and nginx.
set -e

echo '──────────────────────────────────────────────────'
echo " SafeStorage ${SAFESTORAGE_VERSION:-dev} (commit ${SAFESTORAGE_COMMIT:-unknown})"
echo '──────────────────────────────────────────────────'

# Everything the application writes lives under /app so it can be bind mounted
# or declared as a volume.
mkdir -p \
	/app/uploads/live \
	/app/uploads/tmp \
	/app/uploads/zips \
	/app/uploads/thumbs/preview \
	/app/database \
	/app/logs

if [ -n "${SKIP_MIGRATIONS:-}" ]; then
	echo '[entrypoint] SKIP_MIGRATIONS is set, skipping database migrations'
else
	echo '[entrypoint] Applying database migrations...'
	# Prisma 7 reads the schema location *and* the database URL from
	# packages/backend/prisma.config.ts, so the CLI is pointed at that file
	# explicitly instead of relying on the current working directory.
	# HOME is only needed so Prisma has a writable place for its cache.
	HOME=/app node /app/node_modules/prisma/build/index.js migrate deploy \
		--config /app/packages/backend/prisma.config.ts
fi

echo "[entrypoint] Starting SafeStorage (nginx :80, frontend :8001, backend :8000)"
exec "$@"
