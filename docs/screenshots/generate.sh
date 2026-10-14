#!/usr/bin/env sh
#
# Regenerates the screenshots in this folder.
#
# It boots a throwaway SafeStorage container from the published image, seeds it
# with synthetic demo data (see capture.mjs) and drives a headless browser
# through the pages referenced from the root README.
#
# Requirements: docker, node >= 20 and a Chromium/Chrome build. Playwright's own
# browsers are downloaded on `npm install`; set PW_CHANNEL=chrome to reuse a
# system Chrome instead.
#
# Usage:
#   ./generate.sh                              # pull the published image and capture
#   SAFESTORAGE_PORT=24426 ./generate.sh       # avoid a port clash
#   SAFESTORAGE_BASE_URL=http://localhost:8001 ./generate.sh   # use an instance you already run
#   SAFESTORAGE_IMAGE=safestorage:local ./generate.sh          # use a locally built image
#
# The script starts a throwaway MariaDB container next to the application one, so
# it needs no database of its own.
set -eu

cd "$(dirname "$0")"

IMAGE="${SAFESTORAGE_IMAGE:-ghcr.io/ivancarlosti/safestorage:latest}"
DB_IMAGE="${SAFESTORAGE_DB_IMAGE:-mariadb:11.4}"
PORT="${SAFESTORAGE_PORT:-24425}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
CONTAINER="${SAFESTORAGE_CONTAINER:-safestorage-screenshots}"
DB_CONTAINER="${SAFESTORAGE_DB_CONTAINER:-safestorage-screenshots-db}"
NETWORK="${SAFESTORAGE_NETWORK:-safestorage-screenshots-net}"
BASE_URL="${SAFESTORAGE_BASE_URL:-http://localhost:${PORT}}"

DATA_DIR=""
STARTED_CONTAINER=0
STARTED_DB=0
STARTED_NETWORK=0

cleanup() {
	if [ "$STARTED_CONTAINER" = "1" ]; then
		echo "[generate] stopping ${CONTAINER}"
		# Anonymous volumes are removed together with the container.
		docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
	fi
	if [ "$STARTED_DB" = "1" ]; then
		echo "[generate] stopping ${DB_CONTAINER}"
		docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
	fi
	if [ "$STARTED_NETWORK" = "1" ]; then
		docker network rm "$NETWORK" >/dev/null 2>&1 || true
	fi
	if [ -n "$DATA_DIR" ] && [ -d "$DATA_DIR" ]; then
		rm -rf "$DATA_DIR"
	fi
}
trap cleanup EXIT INT TERM

if [ -z "${SAFESTORAGE_BASE_URL:-}" ]; then
	echo "[generate] starting ${IMAGE} on port ${PORT}"

	docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
	docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
	docker network rm "$NETWORK" >/dev/null 2>&1 || true
	docker network create "$NETWORK" >/dev/null
	STARTED_NETWORK=1

	echo "[generate] starting ${DB_IMAGE}"
	docker run -d --rm \
		--name "$DB_CONTAINER" \
		--network "$NETWORK" \
		-e MARIADB_ROOT_PASSWORD=root \
		-e MARIADB_DATABASE=safestorage \
		-e MARIADB_USER=safestorage \
		-e MARIADB_PASSWORD=safestorage \
		"$DB_IMAGE" \
		--character-set-server=utf8mb4 \
		--collation-server=utf8mb4_unicode_ci >/dev/null
	STARTED_DB=1

	echo '[generate] waiting for the database to accept connections'
	attempt=1
	until docker exec "$DB_CONTAINER" healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; do
		if [ "$attempt" -ge 60 ]; then
			echo '[generate] the database did not come up in time' >&2
			exit 1
		fi
		attempt=$((attempt + 1))
		sleep 2
	done

	# Anonymous volumes: the container writes to them as root, but Docker cleans
	# them up for us on `--rm`, so nothing is left behind on the host.
	docker run -d --rm \
		--name "$CONTAINER" \
		--network "$NETWORK" \
		-p "${PORT}:80" \
		-e "ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
		-e "DATABASE_URL=mysql://safestorage:safestorage@${DB_CONTAINER}:3306/safestorage" \
		-e TZ=UTC \
		-v /app/uploads \
		-v /app/logs \
		"$IMAGE" >/dev/null

	STARTED_CONTAINER=1
else
	echo "[generate] using the instance already running at ${BASE_URL}"
fi

if [ ! -d node_modules/playwright ]; then
	echo "[generate] installing browser automation dependencies"
	npm install --no-fund --no-audit
fi

BASE_URL="$BASE_URL" ADMIN_PASSWORD="$ADMIN_PASSWORD" node capture.mjs

echo "[generate] done. Screenshots written to $(pwd)"
