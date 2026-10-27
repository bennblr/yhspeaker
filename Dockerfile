# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
COPY desktop/package.json ./desktop/package.json
COPY platform/package.json ./platform/package.json

RUN npm ci

COPY shared ./shared
COPY server ./server
COPY web ./web
COPY platform ./platform

RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/platform/package.json ./platform/package.json
COPY --from=build /app/platform/dist ./platform/dist

RUN mkdir -p /app/platform-data

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PLATFORM_PORT || 4100) + '/api/platform/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "platform/dist/index.js"]
