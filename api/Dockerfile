# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Local compose builds this target and never reaches the token fetch below.
# Source is bind-mounted, and so is the careersim-studio `plugins` directory
# (`CAREERSIM_PLUGIN_DIR`). `pnpm dev` copies from that directory and restarts
# when the plugin files change.
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 8000
CMD ["pnpm", "dev"]

FROM base AS deps
# pnpm-workspace.yaml carries the pnpm.overrides security patches — without
# it the frozen install fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN apk add --no-cache python3 make g++ \
 && pnpm install --frozen-lockfile --prod=false

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Production fetch. Development (`target: dev`, used by
# docker-compose.local.yml) does not run this step: it bind-mounts the
# local plugin checkout and hot-reloads it. A development build of this
# stage also skips the token and leaves plugin loading to runtime.
ARG NODE_ENV=production
ARG CAREERSIM_PLUGINS
ARG CAREERSIM_PLUGIN_REF
ARG CAREERSIM_PLUGIN_TOKEN
ENV CAREERSIM_PLUGINS=$CAREERSIM_PLUGINS
ENV CAREERSIM_PLUGIN_REF=$CAREERSIM_PLUGIN_REF
RUN --mount=type=secret,id=careersim_plugin_token,required=false \
    if [ "$NODE_ENV" = "development" ]; then \
      echo "plugins: development build skips the GitHub token; runtime reads CAREERSIM_PLUGIN_DIR"; \
      mkdir -p dist; \
    else \
      TOKEN="$(cat /run/secrets/careersim_plugin_token 2>/dev/null || true)"; \
      if [ -z "$TOKEN" ]; then TOKEN="$CAREERSIM_PLUGIN_TOKEN"; fi; \
      CAREERSIM_PLUGIN_TOKEN="$TOKEN" pnpm build; \
    fi

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN apk add --no-cache python3 make g++ \
 && pnpm install --frozen-lockfile --prod=true \
 && apk del python3 make g++

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./dist/db/migrations
COPY package.json ./
USER app
EXPOSE 8000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
