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
set -eu

cd "$(dirname "$0")"

IMAGE="${SAFESTORAGE_IMAGE:-ghcr.io/ivancarlosti/safestorage:latest}"
PORT="${SAFESTORAGE_PORT:-24425}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
CONTAINER="${SAFESTORAGE_CONTAINER:-safestorage-screenshots}"
BASE_URL="${SAFESTORAGE_BASE_URL:-http://localhost:${PORT}}"

DATA_DIR=""
STARTED_CONTAINER=0

cleanup() {
	if [ "$STARTED_CONTAINER" = "1" ]; then
		echo "[generate] stopping ${CONTAINER}"
		# Anonymous volumes are removed together with the container.
		docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
	fi
	if [ -n "$DATA_DIR" ] && [ -d "$DATA_DIR" ]; then
		rm -rf "$DATA_DIR"
	fi
}
trap cleanup EXIT INT TERM

if [ -z "${SAFESTORAGE_BASE_URL:-}" ]; then
	echo "[generate] starting ${IMAGE} on port ${PORT}"

	docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

	# Anonymous volumes: the container writes to them as root, but Docker cleans
	# them up for us on `--rm`, so nothing is left behind on the host.
	docker run -d --rm \
		--name "$CONTAINER" \
		-p "${PORT}:80" \
		-e "ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
		-e TZ=UTC \
		-v /app/uploads \
		-v /app/database \
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
