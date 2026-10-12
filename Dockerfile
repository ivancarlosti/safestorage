# SafeStorage - single, combined production image
#
# Builds the whole project from source and ships it as ONE container:
#   nginx (:80) -> static uploads + reverse proxy
#               -> Fastify backend   (127.0.0.1:8000)
#               -> Next.js frontend  (127.0.0.1:8001)
#
# The .github/workflows/build.yml workflow builds exactly this file with
# `context: .` and stamps the release through the VERSION / COMMIT build args.

# ---------------------------------------------------------------------------
# Stage 1: build everything (backend dist, prisma client, Next.js standalone)
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

ARG VERSION=dev
ARG COMMIT=unknown

# `git` is used by some install scripts, `libc6-compat` is required by the
# native tooling (sharp/swc), `openssl` by the Prisma engines.
# CI=true keeps `yarn install` fully non-interactive inside the build context
# (which has no .git directory) and disables telemetry/prompt interruptions.
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache git libc6-compat openssl

WORKDIR /app

# Yarn 4 is vendored in the repository (.yarn/releases) and pinned through
# package.json#packageManager, so no extra download step is required.
COPY . .

RUN yarn install --immutable

# Stamp the release before building: the backend reads the version from the
# root package.json at runtime (/api/version, admin panel, startup log) and the
# frontend bakes it in as NEXT_PUBLIC_VERSION during `next build`.
RUN node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,'\t')+'\n');" "${VERSION}" \
 && node -e "const fs=require('fs');fs.writeFileSync('/app/.version',process.argv[1]+'\n');" "${VERSION}" \
 && node -e "const fs=require('fs');fs.writeFileSync('/app/.commit',process.argv[1]+'\n');" "${COMMIT}"

# The backend is a yarn workspace: the generated Prisma client must exist before
# `tsc` runs because the source imports types from @prisma/client.
RUN yarn workspace @safestorage/backend generate \
 && yarn workspace @safestorage/backend build

# Next.js standalone output (server.js + the traced node_modules subtree).
RUN yarn workspace @safestorage/next build

# Drop every dependency the frontend brought in: the standalone bundle already
# carries its own node_modules, while the backend keeps everything it needs at
# runtime (including the Prisma CLI that applies the migrations on start).
RUN yarn workspaces focus @safestorage/backend \
 && yarn workspace @safestorage/backend generate \
 && mkdir -p /app/packages/backend/node_modules

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

ARG VERSION=dev
ARG COMMIT=unknown

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    HOSTNAME=0.0.0.0 \
    PORT=8000 \
    BASE_API_URL=http://127.0.0.1:8000 \
    NEXT_TELEMETRY_DISABLED=1 \
    SAFESTORAGE_VERSION=${VERSION} \
    SAFESTORAGE_COMMIT=${COMMIT}

# nginx       - reverse proxy and static upload server (replaces Caddy)
# supervisor  - process manager for the three services in this container
# ffmpeg      - thumbnail generation for video uploads (checked by the backend)
RUN apk add --no-cache nginx supervisor ffmpeg openssl libc6-compat

WORKDIR /app

# ---- backend -------------------------------------------------------------
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=builder /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/src/prisma ./packages/backend/src/prisma

# ---- frontend (Next.js standalone) ---------------------------------------
# The standalone tree is self contained (server.js + node_modules + .next), so
# it is kept out of the backend's way in its own folder.
COPY --from=builder /app/packages/next/.next/standalone ./frontend
COPY --from=builder /app/packages/next/.next/static ./frontend/packages/next/.next/static
COPY --from=builder /app/packages/next/public ./frontend/packages/next/public

# ---- container plumbing --------------------------------------------------
COPY container/nginx.conf /etc/nginx/nginx.conf
COPY container/supervisord.conf /etc/supervisor/safestorage.conf
COPY container/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=builder /app/.version /app/.commit ./version/

RUN chmod +x /usr/local/bin/entrypoint.sh \
 && rm -f /etc/nginx/http.d/default.conf \
 && mkdir -p \
	/app/uploads/live \
	/app/uploads/tmp \
	/app/uploads/zips \
	/app/uploads/thumbs/preview \
	/app/database \
	/app/logs \
 && nginx -t

EXPOSE 80

# One probe covers all three processes: /api/health is answered by Fastify
# through nginx, / is rendered by Next.js through nginx.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
	CMD wget -qO- http://127.0.0.1/api/health > /dev/null \
	 && wget -qO- http://127.0.0.1/ > /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisor/safestorage.conf"]
