# nover-wrier

> Autonomous Novel Generation Platform (Web & Cloud Adaptation)

## Overview

`nover-wrier` is a monorepo platform that adapts autonomous novel writing workflows into a multi-user, web-accessible application. It provides:
- **Phase 1: Real-Time Interactive Planning** via a pseudo-terminal (PTY) session streaming bidirectional WebSockets to an xterm.js terminal island.
- **Phase 2: Queue-Driven Background Generation** powered by BullMQ and Redis for robust multi-chapter drafting, continuity auditing, and compilation into EPUB/PDF/Markdown with Pandoc.

## Repository Structure

```text
nover-wrier/
├── .github/                         # CI/CD workflows
│   └── workflows/deploy.yml
├── apps/
│   ├── web/                         # Frontend Application (Astro 4+ with React Islands)
│   └── server/                      # Orchestration Backend (NestJS 10+)
├── packages/                        # Shared Internal Libraries
│   ├── types/                       # Shared DTOs, WebSocket events, Novel Interfaces
│   └── tsconfig/                    # Shared TypeScript base configs
├── workspaces/                      # Session runtime directories (Git-ignored)
│   ├── active/                      # Active generation sessions
│   └── completed/                   # Finished books ready for download
├── docker-compose.yml               # Multi-container orchestration (Server, Redis, Web)
├── pnpm-workspace.yaml              # Workspace topology configuration
├── package.json                     # Root monorepo scripts
├── .gitignore
└── README.md
```

## Quick Start

### Prerequisites
- Node.js (v20+ or v22+)
- pnpm (v9+)
- Docker & Docker Compose (optional for local container execution)
- Python 3 & Pandoc (for manuscript compilation)

### Development

Install all workspace dependencies:
```bash
pnpm install
```

Start development servers:
```bash
pnpm dev
```

Build all packages and applications:
```bash
pnpm build
```

Run linting:
```bash
pnpm lint
```

### Docker Compose

Run all services (Server, Redis, and Web):
```bash
docker compose up --build
```
