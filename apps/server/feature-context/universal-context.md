# Universal System Architecture & Technical Context Specification

**Project:** Autonomous Novel Generation Platform (Web & Cloud Adaptation)  
**Document Version:** 1.1.0  
**Status:** Living Technical Architecture Document  
**Repository Name:** `nover-wrier`  
**Repository Pattern:** Monorepo with `pnpm` Workspaces  
**Target Environment:** Docker-based Cloud Sandbox (VPS / Containerized Host)  

---

## 1. System Overview & Core Philosophy

### 1.1 Executive Summary
This platform adapts the autonomous novel-writing repository into a multi-user, web-accessible cloud platform. It enables users to interactively plan stories in real time, inspect narrative blueprints, and execute end-to-end manuscript drafting and compilation with zero human intervention during drafting.

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: REAL-TIME INTERACTIVE PLANNING                     │
│ Mode: Plan Mode | Execution: Synchronous / Interactive      │
│ Interface: Bidirectional WebSockets via Virtual PTY         │
│ Goal: Story interview, character bibles, dynamic outline   │
└──────────────────────────────┬──────────────────────────────┘
                               │
               Signal: User Approves Plan
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: ASYNCHRONOUS QUEUE-DRIVEN GENERATION               │
│ Mode: Build Mode | Execution: Background Batch Worker       │
│ Interface: BullMQ + Redis Message Queue                     │
│ Goal: Multi-chapter drafting, continuity audit, compilation │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 The "Black Box Engine" Principle
* **Zero Repo Modification:** The core novel-writing engine (prompts, directory structures, bash scripts, and compilation pipelines) is treated as an immutable, black-box orchestration engine.
* **Separation of Concerns:** The engine logic remains untouched. Networking, process management, authentication, queue scheduling, and streaming interfaces are decoupled into an outer containerized application layer.
* **Extensibility:** The system avoids hardcoding vendors, models, or story dimensions (e.g., chapter counts or word targets), allowing full configurability via external interfaces.

---

## 2. Monorepo Architecture (`pnpm` Workspaces)

Following industry standards for enterprise monorepo management, the codebase is organized under a unified `pnpm` workspace topology. This guarantees strict dependency isolation, eliminates phantom dependencies, and enables type-safe contracts between the frontend and backend.

### 2.1 Monorepo Topology
* **Root (`/`):** Contains workspace declarations (`pnpm-workspace.yaml`), root package scripts, container definitions (`docker-compose.yml`), CI/CD workflows, Biome config, and shared dev tooling.
* **`apps/`:** Deployable application runtimes.
  * `apps/web`: Astro-based client interface using Islands Architecture for low runtime overhead and React components for interactive widgets.
  * `apps/server`: NestJS-based orchestration engine managing WebSockets, PTY sessions, workspace directories, and BullMQ queues.
* **`packages/`:** Shared internal libraries referenced via the `workspace:*` protocol.
  * `packages/types`: Shared DTOs, WebSocket event contracts, and novel state interfaces.
  * `packages/tsconfig`: Centralized TypeScript configuration presets (`base.json`, `astro.json`, `nestjs.json`).
* **`engine/`:** The untouched autonomous novel writing engine template (`engine/template/`).
* **`workspaces/`:** Runtime session storage (isolated active user folders, git-ignored).

### 2.2 Complete Monorepo Directory Tree

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
│       ├── feature-context/         # Granular feature documentation and specifications
│       │   ├── check.md             # Implementation tracking checklist
│       │   └── universal-context.md # This universal specification document
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

### 2.3 Workspace Configurations

#### `pnpm-workspace.yaml`
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
allowBuilds:
  esbuild: true
  msgpackr-extract: true
  node-pty: true
```

#### Root `package.json`
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
  }
}
```

---

## 3. Container Environment & Toolchain (Docker Runtime)

### 3.1 Container Specifications
The execution environment is encapsulated in a reproducible Linux container designed to provide all dependencies required by both the agent CLI and the repo’s automation scripts:
* **Base Operating System:** Ubuntu 22.04 LTS (x86_64 or ARM64) / Debian Bookworm Slim.
* **Primary Runtime Environments:**
  * **Node.js (LTS v20+ / v22):** Required to run the agent CLI (`opencode`) and the NestJS orchestration backend.
  * **Python 3 (3.10+):** Required by repository automation scripts (`make_books.py`, `automation/dashboard.py`, `automation/system-health-check.sh`).
* **System Utilities & Compilers:**
  * `pandoc`: Core dependency for converting generated markdown chapters into compiled `.epub` and `.docx` formats.
  * `build-essential`, `make`, `g++`: Required to compile native bindings for `node-pty`.
  * `git`, `curl`, `ca-certificates`, `bash`.

### 3.2 Volume & Session Isolation Strategy
* **Template Storage:** The untouched engine is kept in `engine/template/`.
* **Runtime Workspaces:** For each novel session, `workspace.service.ts` copies the template into an isolated directory (`workspaces/active/<novel-id>/`).
* **Concurrency Safety:** Every user session operates in its own directory. No chapter files, JSON tracking files, or script executions collide.
* **Archive on Complete:** Upon generation completion, files are archived to `workspaces/completed/<novel-id>/`.

---

## 4. Pluggable AI Multi-Provider Layer

### 4.1 Abstract Provider Architecture
The platform implements a multi-provider gateway rather than binding to a single AI vendor. The system communicates through OpenAI-compatible interfaces or unified agent gateways, supporting dynamic fallback and tiering across:
* **OpenCode Zen:** Unified gateway for frontier reasoning and coding models.
* **OpenRouter:** Distributed pool of open-source and commercial models with fallback support.
* **Google AI Studio:** High-throughput, large-context models (e.g., Gemini series).
* **Groq / Cerebras / SambaNova:** High-speed inference engines for fast drafting cycles.

### 4.2 Dual-Mode Model Routing Strategy
The system decouples model selection by operational phase via `opencode.json`:
* **Plan Mode Model:** Configured for deep reasoning, architectural coherence, and contextual comprehension (e.g., structured reasoning models with massive context windows).
* **Build Mode Model:** Configured for literary cadence, scene drafting speed, and instruction-following consistency.

### 4.3 Headless Authentication & Key Management
To prevent interactive login prompts (`/connect` or interactive TUI logins) from halting cloud execution:
* **Environment Injection:** API credentials are authenticated headlessly via container environment variables (e.g., `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`).
* **Pre-seeded Credential Manifest:** If running in containerized environments without shell persistence, credentials are pre-seeded at boot into `~/.local/share/opencode/auth.json`.

---

## 5. Dual-Phase Execution Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: REAL-TIME INTERACTIVE PLANNING                     │
│ Mode: Plan Mode | Execution: Synchronous / Interactive      │
│ Interface: Bidirectional WebSockets via Virtual PTY         │
│ Goal: Story interview, character bibles, dynamic outline   │
└──────────────────────────────┬──────────────────────────────┘
                               │
               Signal: User Approves Plan
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: ASYNCHRONOUS QUEUE-DRIVEN GENERATION               │
│ Mode: Build Mode | Execution: Background Batch Worker       │
│ Interface: BullMQ + Redis Message Queue                     │
│ Goal: Multi-chapter drafting, continuity audit, compilation │
└─────────────────────────────────────────────────────────────┘
```

### 5.1 Configurable Story Dimensions
* Story length, act structures, and chapter counts are treated as **dynamic runtime parameters**.
* The AI planner establishes the chapter blueprint during Phase 1 based on user preferences; no hardcoded chapter limits exist at the infrastructure level.

---

## 6. Real-Time Interactive Planning Bridge (Phase 1 Feature)

### 6.1 Virtual PTY Management (`node-pty`)
* The NestJS backend spawns the OpenCode CLI inside a pseudo-terminal (PTY) instance using `node-pty`.
* The PTY emulates a full POSIX-compliant terminal (`xterm-256color`), capturing standard output (`stdout`), standard error (`stderr`), and interactive prompts without losing escape sequences.

### 6.2 Bidirectional WebSocket Gateway
* **Protocol:** WebSockets managed via `@nestjs/websockets` (leveraging `socket.io`).
* **Downstream Stream (CLI ➔ Web UI):** Real-time terminal output is chunked and streamed directly to the frontend client.
* **Upstream Stream (Web UI ➔ CLI):** User keystrokes, multiple-choice selections, and custom text inputs are piped directly into the PTY process’s `stdin`.

### 6.3 Astro Client Integration (Islands Architecture)
* **Static Shell:** Page structure, headers, and meta tags are rendered using Astro components (`.astro`) with zero client-side JavaScript.
* **Interactive Islands:** Terminal emulation is encapsulated in a client island:
  ```astro
  ---
  import Layout from '../../layouts/Layout.astro';
  import XtermTerminal from '../../components/terminal/XtermTerminal';
  const { id } = Astro.params;
  ---
  <Layout title="Story Planning">
    <main class="p-6">
      <XtermTerminal client:only="react" novelId={id} />
    </main>
  </Layout>
  ```
* `client:only="react"` prevents Server-Side Rendering (SSR) issues since `xterm.js` requires the browser `window` object.

---

## 7. Programmatic Mode Transition Feature

### 7.1 Transition Trigger
* The planning phase concludes with a generated narrative outline. The user clicks **"Approve Plan & Start Writing"** on the web interface.

### 7.2 The Tab-Key Automation Mechanism
* OpenCode natively toggles between `plan` mode and `build` mode via the `Tab` key.
* **Cloud Automation:** Upon receiving the approval event, the backend terminal service injects the ASCII horizontal tab control character (`\t` or hex `\x09`) into the PTY process's `stdin`:
  ```typescript
  ptySession.write('\t');
  ```
* This triggers OpenCode to switch into Build Mode, enabling file writes, bash command execution, and access to the Build model.

---

## 8. Queue-Driven Background Generation Engine (Phase 2 Feature)

### 8.1 Architecture & Decoupling
* **Decoupled Lifecycle:** Manuscript generation takes extended periods. Phase 2 jobs are decoupled from client connections and managed by **BullMQ** backed by **Redis**.
* **Client Resilience:** Users can safely disconnect, close browser tabs, or experience network drops without interrupting drafting progress.

### 8.2 Job Enqueueing & Concurrency Control
* When Plan Mode transitions to Build Mode, a job payload is dispatched to the `novel-generation` queue:
  ```json
  {
    "novelId": "uuid-v4",
    "sessionPath": "/workspaces/active/uuid-v4",
    "config": {
      "timestamp": "2026-09-06T12:00:00Z"
    }
  }
  ```
* **Host Resource Throttling:** Concurrency limits on the BullMQ processor protect the VPS from CPU/RAM exhaustion:
  ```typescript
  @Processor('novel-generation', { concurrency: 1 })
  ```

### 8.3 Lifecycle Monitoring
* The processor monitors workspace state transitions (inspecting `manuscript/chapters/` and state files) and emits progress milestones to Redis pub/sub.

---

## 9. Book Compilation & Artifact Delivery Feature

### 9.1 Completion Trigger
* The drafting loop concludes when all planned chapter files are written, verified, and reconciled by the autonomous pipeline.
* OpenCode invokes the repository's compilation utility:
  ```bash
  python3 make_books.py
  ```

### 9.2 Output Harvesting & Artifact Serving
* `make_books.py` bundles the markdown manuscript into production-ready `.epub`, `.docx`, and clean `.md` files inside the `manuscript/` directory.
* **Serving Layer:** A dedicated NestJS `BooksController` exposes secure, token-gated download endpoints (e.g., `GET /api/novels/:id/download/:format`).
* **Delivery Event:** The background worker emits a `generation:completed` event, updating the database/UI and displaying the download modal to the user.

---

## 10. Comprehensive Technology Stack & Dependencies

| Layer / Domain | Technology / Library | Purpose & Rationale |
| :--- | :--- | :--- |
| **Monorepo Manager** | **`pnpm` Workspaces** | Strict dependency resolution, fast hard-linked storage, and `workspace:*` internal linking. |
| **Frontend Framework** | **Astro 4+ (`@astrojs/react`, `@astrojs/tailwind`)** | Lightweight content-driven architecture with zero-JS static base and selective React islands. |
| **Frontend Terminal** | **`xterm.js` + `xterm-addon-fit`** | Browser-based terminal emulator for rendering interactive CLI sessions. |
| **Icons** | **`@lucide/astro`** | Clean, modern iconography for UI elements. |
| **Backend Core** | **NestJS 10+ (TypeScript)** | Modular enterprise framework providing dependency injection, controllers, and gateways. |
| **Real-Time Streaming** | **`@nestjs/websockets` + `socket.io`** | Low-latency bidirectional transport for terminal streaming and user inputs. |
| **Terminal Automation** | **`node-pty`** | Microsoft-maintained pseudo-terminal bridge powering process control and ASCII escape handling. |
| **Job Queue & Broker** | **BullMQ + Redis (local container)** | Asynchronous background processing, retry semantics, and concurrency gating. |
| **Agent CLI Engine** | **OpenCode CLI** | Autonomous agent CLI capable of dual-mode execution (Plan & Build) and tool execution. |
| **Document Compiler** | **Python 3 + Pandoc** | Local compilation engine used by `make_books.py` to generate `.epub` and `.docx` artifacts. |
| **Container Platform** | **Docker & Docker Compose** | Reproducible virtualization layer encapsulating Node, Python, and system binaries. |
| **Linter & Formatter** | **Biome (`@biomejs/biome`)** | Fast linting, import sorting, and code formatting via `biome.json`. |
| **Testing Engine** | **Vitest** | Fast unit test runner for shared packages and backend modules. |
| **AI Integration** | **Pluggable Multi-Provider (Zen / OpenRouter / Google / Groq)** | Multi-tier model routing configured dynamically via `opencode.json`. |

---

## 11. Future Scalability & Architecture Evolution

This containerized prototype is designed with clean architectural boundaries to allow a seamless migration to full-scale SaaS production:

1. **State Migration:** The file-based JSON tracking (`planning/*.json`) can be swapped for a relational schema (PostgreSQL / Supabase) by replacing the shell synchronizer with direct ORM repository calls.
2. **Compute Decoupling:** The local container runtime can evolve into cloud sandbox workers (e.g., AWS ECS, Modal, or E2B) triggered via the existing BullMQ queue interface.
3. **Multi-Tenant Storage:** Local disk mounts can be redirected to S3-compatible object storage (AWS S3 / Cloudflare R2) without changing the download controller contract.

---

## 12. Feature Context Index

Each individual functional area is broken down into its dedicated specification file inside `apps/server/feature-context/`:

- `01-system-overview-and-core-philosophy.md`: Deep dive into system goals and the Black Box Engine principle.
- `02-monorepo-architecture.md`: In-depth pnpm workspace topology, configs, and package contracts.
- `03-container-environment-and-session-isolation.md`: Docker specifications, toolchain, and volume isolation.
- `04-pluggable-ai-multi-provider-layer.md`: Model tiering, provider routing, and headless credential management.
- `05-dual-phase-execution-lifecycle.md`: Execution lifecycle mechanics and dynamic story dimensions.
- `06-real-time-interactive-planning-bridge.md`: Pseudo-terminal streaming, WebSocket gateway, and xterm island.
- `07-programmatic-mode-transition.md`: Approval hooks and the Tab-key automation mechanism.
- `08-queue-driven-background-generation-engine.md`: BullMQ queue, Redis job dispatcher, and resource throttling.
- `09-book-compilation-and-artifact-delivery.md`: Compilation harvesting via make_books.py and download endpoints.
- `10-technology-stack-and-dependencies.md`: Detailed rationale for every dependency and tool choice.
- `11-future-scalability-and-architecture-evolution.md`: Migration path toward SaaS production scale.
