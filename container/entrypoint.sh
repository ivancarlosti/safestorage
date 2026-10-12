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
	# The sqlite database path is relative to the Prisma schema
	# (packages/backend/src/prisma/schema.prisma -> /app/database/database.sqlite).
	# HOME is only needed so Prisma has a writable place for its cache.
	HOME=/app node /app/node_modules/prisma/build/index.js migrate deploy \
		--schema /app/packages/backend/src/prisma/schema.prisma
fi

echo "[entrypoint] Starting SafeStorage (nginx :80, frontend :8001, backend :8000)"
exec "$@"
