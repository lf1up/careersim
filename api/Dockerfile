ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN apk add --no-cache python3 make g++ \
 && pnpm install --frozen-lockfile --prod=false

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml* ./
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
