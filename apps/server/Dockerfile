# Stage 1: Base image with system build tools, Python 3, and Pandoc
FROM node:22-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    pandoc \
    build-essential \
    make \
    g++ \
    curl \
    git \
    ca-certificates \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Pre-seed OpenCode CLI headless authentication manifest. Atomic chaining ensures
# the credential template is never committed to intermediate layers with permissive umask.
RUN mkdir -p ~/.local/share/opencode && \
    echo '{\n  "zen": { "key": "env:OPENCODE_API_KEY" },\n  "openrouter": { "key": "env:OPENROUTER_API_KEY" },\n  "google": { "key": "env:GEMINI_API_KEY" }\n}' > ~/.local/share/opencode/auth.json && \
    chmod 0600 ~/.local/share/opencode/auth.json

WORKDIR /app

# Stage 2: Dependencies and build
FROM base AS builder

COPY pnpm-lock.yaml* pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/

RUN pnpm install --frozen-lockfile=false

RUN pnpm --filter @nover-wrier/types build
RUN pnpm --filter @nover-wrier/server build

# Stage 3: Production Runner
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app /app

EXPOSE 3000

CMD ["pnpm", "--filter", "@nover-wrier/server", "start:prod"]
