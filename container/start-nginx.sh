#!/bin/sh
# Starts nginx once both upstreams of the reverse proxy answer.
#
# supervisord launches the backend, the frontend and nginx at the same moment,
# and Docker probes the healthcheck right away. Until Fastify (:8000) and
# Next.js (:8001) are listening, every proxied request makes nginx log
# "connect() failed (111: Connection refused) ... upstream", which is only
# boot noise and hides real upstream failures.
set -e

# 60 attempts x 2s: enough for a cold start, short enough to still bring nginx
# up (so the healthcheck can report the failure) when a process is broken.
wait_attempts="${NGINX_WAIT_ATTEMPTS:-60}"

wait_for() {
	name="$1"
	url="$2"
	attempt=1

	while ! wget -q -O /dev/null "$url" 2> /dev/null; do
		if [ "$attempt" -ge "$wait_attempts" ]; then
			echo "[start-nginx] ${name} did not answer after ${wait_attempts} attempts, starting nginx anyway"
			return 0
		fi

		attempt=$((attempt + 1))
		sleep 2
	done

	echo "[start-nginx] ${name} is answering"
}

wait_for backend http://127.0.0.1:8000/api/health
wait_for frontend http://127.0.0.1:8001/

exec nginx -g 'daemon off;'
