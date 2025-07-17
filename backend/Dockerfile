# Build stage
FROM node:22-alpine AS builder

# Install build dependencies and pnpm
RUN apk add --no-cache python3 make g++ && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json pnpm-lock.yaml* ./

# Install all dependencies (including dev dependencies for building)
RUN pnpm install

# Copy source code
COPY . .

# Build the application (only if not in development mode)
ARG NODE_ENV=production
RUN if [ "$NODE_ENV" != "development" ]; then \
      pnpm run build; \
    else \
      mkdir -p dist; \
    fi

# Production/Development stage
FROM node:22-alpine AS runtime

# Install pnpm and create app user for security
RUN corepack enable && \
    corepack prepare pnpm@latest --activate && \
    addgroup -g 1001 -S nodejs && \
    adduser -S careersim -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json pnpm-lock.yaml* ./

# Install dependencies based on NODE_ENV
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

# Install dependencies (dev dependencies if development, production only if production)
RUN if [ "$NODE_ENV" = "development" ]; then \
      pnpm install; \
    else \
      pnpm install --prod && pnpm store prune; \
    fi

# Copy source code
COPY --chown=careersim:nodejs . .

# Copy dist folder from builder stage
COPY --from=builder --chown=careersim:nodejs /app/dist ./dist

# Create uploads directory and set permissions
RUN mkdir -p uploads && chown -R careersim:nodejs uploads

# Switch to non-root user
USER careersim

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { host: 'localhost', port: 3000, path: '/health', timeout: 2000 }; \
    const req = http.request(options, (res) => { \
      if (res.statusCode === 200) process.exit(0); \
      else process.exit(1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end();" || exit 1

# Default command (can be overridden in docker-compose)
CMD ["pnpm", "start"] 