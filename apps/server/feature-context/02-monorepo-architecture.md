# Feature Context: Monorepo Architecture (`pnpm` Workspaces)

**Section:** 2  
**Module Alignment:** Workspace Infrastructure & Dependency Topology  
**Status:** Canonical Reference  

---

## 1. Architectural Strategy & Rationale

Following enterprise standards for monorepo management, the codebase is organized under a unified `pnpm` workspace topology. This structure achieves:
1. **Strict Dependency Isolation:** Prevents phantom dependencies and enforces explicit dependency declarations for every package.
2. **Type-Safe Internal Contracts:** Shared TypeScript interfaces (`@nover-wrier/types`) linked via the `workspace:*` protocol guarantee end-to-end type parity between the Astro client and NestJS backend.
3. **Reproducible Tooling:** Centralized TypeScript base presets (`@nover-wrier/tsconfig`), formatting and linting via Biome, and unified testing via Vitest.
4. **Hard-Linked Package Storage:** `pnpm` provides fast installation times and minimal disk overhead across micro-applications.

---

## 2. Monorepo Topology

The repository divides responsibilities across top-level layers:

* **Root (`/`):** Contains workspace declarations (`pnpm-workspace.yaml`), root package scripts, container definitions (`docker-compose.yml`), CI/CD workflows, Biome config, and shared dev tooling.
* **`apps/`:** Deployable application runtimes.
  * `apps/web`: Astro-based client interface using Islands Architecture for low runtime overhead and React components for interactive widgets.
  * `apps/server`: NestJS-based orchestration engine managing WebSockets, PTY sessions, workspace directories, and BullMQ queues.
* **`packages/`:** Shared internal libraries referenced via the `workspace:*` protocol.
  * `packages/types`: Shared DTOs, WebSocket event contracts, and novel state interfaces.
  * `packages/tsconfig`: Centralized TypeScript configuration presets (`base.json`, `astro.json`, `nestjs.json`).
* **`engine/`:** The untouched autonomous novel writing engine template (`engine/template/`).
* **`workspaces/`:** Runtime session storage (isolated active user folders, git-ignored).

---

## 3. Complete Monorepo Directory Tree

```text
nover-wrier/
├── .github/                         # CI/CD workflows (lint, build, Docker deploy)
│   └── workflows/
│       └── deploy.yml
│
├── apps/
│   ├── web/                         # Frontend Application (Astro 4+ with React Islands)
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── terminal/        # Terminal emulator island (requires browser DOM)
│   │   │   │   │   ├── XtermTerminal.tsx     # xterm.js React component (client:only="react")
│   │   │   │   │   └── TerminalControls.tsx
│   │   │   │   ├── plan/            # Interactive plan review cards & controls
│   │   │   │   │   ├── OptionCard.tsx
│   │   │   │   │   └── PlanApprovalModal.tsx
│   │   │   │   └── book/            # Export modal & reader
│   │   │   │       └── BookExportModal.tsx
│   │   │   ├── layouts/
│   │   │   │   └── Layout.astro     # Core layout with navigation and global styles
│   │   │   ├── pages/
│   │   │   │   ├── index.astro      # Premise entry & initial configuration
│   │   │   │   └── novel/
│   │   │   │       └── [id]/
│   │   │   │           ├── plan.astro    # Phase 1: Real-time PTY terminal streaming
│   │   │   │           └── build.astro   # Phase 2: Progress dashboard & chapter preview
│   │   │   ├── hooks/
│   │   │   │   ├── useSocket.ts     # Client WebSocket connection to NestJS gateway
│   │   │   │   └── useNovelState.ts
│   │   │   └── styles/
│   │   │       └── globals.css
│   │   ├── astro.config.mjs         # Astro config (@astrojs/tailwind, @astrojs/react)
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── tailwind.config.cjs
│   │   └── tsconfig.json
│   │
│   └── server/                      # Orchestration Backend (NestJS 10+)
│       ├── feature-context/         # Individual feature specifications & architecture docs
│       ├── src/
│       │   ├── common/              # Cross-cutting filters, guards, and interceptors
│       │   ├── modules/
│       │   │   ├── terminal/        # PHASE 1: Real-time PTY session management
│       │   │   │   ├── terminal.gateway.ts      # WebSocket Gateway (handles stdin/stdout)
│       │   │   │   ├── terminal.service.ts      # node-pty process manager (sends '\t')
│       │   │   │   └── terminal.module.ts
│       │   │   ├── generator/       # PHASE 2: Background BullMQ Queue & Worker
│       │   │   │   ├── generator.queue.ts       # Job dispatcher
│       │   │   │   ├── generator.processor.ts   # Background worker running Build mode
│       │   │   │   └── generator.module.ts
│       │   │   ├── workspace/       # Session folder cloning & lifecycle
│       │   │   │   ├── workspace.service.ts     # Clones engine template to /workspaces/active
│       │   │   │   └── workspace.module.ts
│       │   │   └── books/           # Compilation harvesting & file delivery
│       │   │       ├── books.controller.ts      # GET /api/novels/:id/download/:format
│       │   │       ├── books.service.ts         # Validates manuscript/ outputs
│       │   │       └── books.module.ts
│       │   ├── app.module.ts
│       │   └── main.ts
│       ├── Dockerfile               # Node.js + Python 3 + Pandoc + OpenCode CLI
│       ├── package.json
│       └── tsconfig.json
│
├── packages/                        # Shared Internal Libraries
│   ├── types/                       # Shared DTOs, WebSocket events, Novel Interfaces
│   │   ├── src/
│   │   │   ├── socket-events.ts     # WebSocket event payloads (Input, Output, Mode Switch)
│   │   │   ├── novel.types.ts       # NovelStatus, ChapterMeta, SessionConfig
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── tsconfig/                    # Shared TypeScript base configs
│       ├── base.json
│       ├── astro.json
│       └── nestjs.json
│
├── engine/                          # THE UNTOUCHED NOVEL WRITING ENGINE
│   └── template/                    # (The exact contents of this repository)
│       ├── .agents/
│       ├── .claude/
│       ├── automation/
│       ├── characters/
│       ├── manuscript/
│       ├── planning/
│       ├── templates/
│       ├── worldbuilding/
│       ├── AGENTS.md
│       ├── CLAUDE.md
│       ├── launch-novel.sh
│       ├── make_books.py
│       └── sync-state.sh
│
├── workspaces/                      # Session runtime directories (Git-ignored)
│   ├── active/                      # Active generation sessions (user_uuid_123/...)
│   └── completed/                   # Finished books ready for download
│
├── biome.json                       # Biome formatter & linter configuration
├── docker-compose.yml               # Multi-container orchestration (Server, Redis, Web)
├── pnpm-workspace.yaml              # Workspace topology configuration
├── package.json                     # Root monorepo scripts
├── .gitignore                       # Ignores node_modules, .env, workspaces/*
└── README.md
```

---

## 4. Workspace Configuration Specifications

### 4.1 `pnpm-workspace.yaml`
Defines package discovery boundaries and declares native build script execution permissions:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
allowBuilds:
  esbuild: true
  msgpackr-extract: true
  node-pty: true
```

### 4.2 Root `package.json`
Acts as the central execution orchestrator:
```json
{
  "name": "nover-wrier",
  "private": true,
  "scripts": {
    "dev": "pnpm --parallel --filter ./apps/* dev",
    "build": "pnpm --recursive run build",
    "test": "vitest run --passWithNoTests",
    "lint": "biome check .",
    "format": "biome format --write .",
    "docker:up": "docker compose up --build",
    "docker:down": "docker compose down",
    "clean": "pnpm --recursive run clean && rm -rf node_modules"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.12",
    "prettier": "^3.9.6",
    "typescript": "^7.0.2",
    "vitest": "^5.0.0"
  }
}
```

### 4.3 Shared Package Contracts
* **`packages/types`:** Referenced as `"@nover-wrier/types": "workspace:*"` inside `apps/web/package.json` and `apps/server/package.json`. It guarantees single-source-of-truth definitions for WebSocket events (`SocketClientEvent`, `SocketServerEvent`) and state models (`NovelStatus`, `NovelState`, `ChapterMeta`).
* **`packages/tsconfig`:** Referenced as `"@nover-wrier/tsconfig": "workspace:*"` providing uniform compiler settings (`base.json`, `astro.json`, `nestjs.json`).
