ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- Dev target: used by docker-compose.local.yml (source mounted in) ---
FROM base AS dev
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
# Source + node_modules are mounted by compose, so the image itself stays lean.
# The container's `command` re-runs `pnpm install` to materialise node_modules
# into the anonymous volume on first boot.
CMD ["pnpm", "dev"]

# --- Build stage: compiles the Next.js app for production ---
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# --- Production runner (optional, not used by local compose) ---
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml* ./
COPY --from=build /app/next.config.mjs ./next.config.mjs
RUN pnpm install --frozen-lockfile --prod=true
USER app
EXPOSE 3000
CMD ["pnpm", "start"]
