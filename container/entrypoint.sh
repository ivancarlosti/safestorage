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
	/app/logs

if [ -z "${DATABASE_URL:-}" ]; then
	echo '[entrypoint] ERROR: DATABASE_URL is not set or is empty.' >&2
	echo '[entrypoint] It must be a MariaDB/MySQL connection string, for example:' >&2
	echo '[entrypoint]   mysql://safestorage:password@host.docker.internal:3306/safestorage' >&2
	exit 1
fi

# Prisma 7 reads the schema location *and* the database URL from
# packages/backend/prisma.config.ts, so the CLI is pointed at that file
# explicitly instead of relying on the current working directory.
# HOME is only needed so Prisma has a writable place for its cache.
#
# `migrate deploy` never touches a shadow database, so no extra privileges are
# required beyond CREATE/ALTER/INSERT on the target database.
prisma_migrate() {
	HOME=/app node /app/node_modules/prisma/build/index.js migrate deploy \
		--config /app/packages/backend/prisma.config.ts
}

if [ -n "${SKIP_MIGRATIONS:-}" ]; then
	echo '[entrypoint] SKIP_MIGRATIONS is set, skipping database migrations'
else
	echo '[entrypoint] Applying database migrations...'
	# The database may live on the Docker host (host.docker.internal) or in a
	# compose service that is still booting, so the first connections are
	# retried instead of crashing the container (DB_WAIT_ATTEMPTS x 2s).
	attempt=1
	max_attempts="${DB_WAIT_ATTEMPTS:-60}"
	until prisma_migrate; do
		if [ "$attempt" -ge "$max_attempts" ]; then
			echo "[entrypoint] Database still unavailable after ${attempt} attempts, giving up." >&2
			exit 1
		fi
		echo "[entrypoint] Attempt ${attempt}/${max_attempts} failed, retrying in 2s..."
		attempt=$((attempt + 1))
		sleep 2
	done
fi

echo "[entrypoint] Starting SafeStorage (nginx :80, frontend :8001, backend :8000)"
exec "$@"
