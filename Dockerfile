# Stage 1: builder
FROM node:22-alpine AS builder

WORKDIR /build

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build
RUN pnpm prune --prod

# Stage 2: runtime
FROM node:22-alpine

RUN apk add --no-cache ripgrep tini su-exec ca-certificates tar gzip
RUN corepack enable
RUN npm install -g supergateway@latest

WORKDIR /app

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json ./package.json

RUN deluser --remove-home node 2>/dev/null; \
    delgroup node 2>/dev/null; \
    addgroup -S yavuz -g 1000 && adduser -S yavuz -G yavuz -u 1000
RUN chown -R yavuz:yavuz /app
RUN mkdir -p /workspace && chown yavuz:yavuz /workspace

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8080 8081

USER yavuz

ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["mcp"]
