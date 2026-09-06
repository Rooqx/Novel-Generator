# Feature Context: Comprehensive Technology Stack & Dependencies

**Section:** 10  
**Module Alignment:** Infrastructure, Frontend Tooling, Backend Runtimes  
**Status:** Canonical Reference  

---

## 1. Technology Selection Matrix

The platform architecture carefully pairs specialized tools with distinct execution profiles across the monorepo:

| Layer / Domain | Technology / Library | Purpose & Architectural Rationale |
| :--- | :--- | :--- |
| **Monorepo Manager** | **`pnpm` Workspaces** | Enforces strict dependency isolation without phantom dependencies; leverages hard links to conserve disk storage across packages; provides native `workspace:*` linking. |
| **Frontend Framework** | **Astro 4+ (`@astrojs/react`, `@astrojs/tailwind`)** | Lightweight content-driven architecture rendering zero client-side JavaScript by default; isolates interactive React components into client islands. |
| **Frontend Terminal** | **`xterm.js` + `xterm-addon-fit`** | Hardware-accelerated terminal emulator for browsers; renders ANSI escape sequences, colors, bolding, and cursor movements from pseudo-terminal streams. |
| **Frontend Icons** | **`@lucide/astro`** | Modern, accessible SVG iconography seamlessly integrated into Astro static shells and components. |
| **Backend Core** | **NestJS 10+ (TypeScript)** | Structured enterprise framework providing modular architecture, dependency injection, exception filters, interceptors, and typed controllers. |
| **Real-Time Streaming** | **`@nestjs/websockets` + `socket.io`** | Low-latency bidirectional transport handling chunked terminal output streaming and upstream user keystrokes with room-based session routing. |
| **Terminal Automation** | **`node-pty`** | C++ POSIX pseudo-terminal bridge that emulates `xterm-256color` and enables programmatic injection of keystrokes (such as the `\t` Tab key mode switch). |
| **Job Queue & Broker** | **BullMQ + Redis (local container)** | Asynchronous background processing, retry semantics, exponential backoff, and host resource throttling (`concurrency: 1`) for long-running chapter drafting. |
| **Agent CLI Engine** | **OpenCode CLI** | Autonomous agent CLI capable of dual-mode execution (Plan Mode for story architecture & Build Mode for scene drafting and bash tool execution). |
| **Document Compiler** | **Python 3 + Pandoc** | Local compilation pipeline invoked via `make_books.py` to produce publication-ready `.epub`, `.docx`, and `.md` manuscript bundles. |
| **Container Platform** | **Docker & Docker Compose** | Reproducible virtualization layer encapsulating Node.js, Python 3, Pandoc, build tools, Redis, and backend/frontend application services. |
| **Linter & Formatter** | **Biome (`@biomejs/biome`)** | High-performance unified linter and code formatter replacing ESLint and Prettier with sub-second execution across the monorepo. |
| **Testing Engine** | **Vitest** | Fast unit and integration testing engine with native TypeScript and ESM support. |
| **AI Integration** | **Pluggable Multi-Provider Layer** | Dynamic multi-tier model routing configured via `opencode.json` across OpenCode Zen, OpenRouter, Google AI Studio, and Groq/Cerebras. |

---

## 2. Dependency Topology & Package Allocation

### 2.1 Monorepo Root (`/`)
* **Dev Tools:** `@biomejs/biome`, `typescript`, `vitest`, `prettier`.
* **Configuration:** `pnpm-workspace.yaml`, `biome.json`, `docker-compose.yml`.

### 2.2 Shared Packages (`packages/`)
* **`@nover-wrier/types`:**
  * Zero external dependencies.
  * Shared source of truth for DTOs, socket events, and novel state models.
* **`@nover-wrier/tsconfig`:**
  * Shared presets: `base.json`, `astro.json`, `nestjs.json`.

### 2.3 Frontend Application (`apps/web/`)
* **Runtime Dependencies:** `astro`, `@astrojs/react`, `@astrojs/tailwind`, `react`, `react-dom`, `tailwindcss`, `socket.io-client`, `@xterm/xterm`, `@xterm/addon-fit`, `@lucide/astro`, `@nover-wrier/types`.
* **Dev Dependencies:** `@types/react`, `@types/react-dom`, `@nover-wrier/tsconfig`.

### 2.4 Backend Service (`apps/server/`)
* **Runtime Dependencies:** `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@nestjs/bullmq`, `bullmq`, `node-pty`, `reflect-metadata`, `rxjs`, `@nover-wrier/types`.
* **Dev Dependencies:** `@nestjs/cli`, `@nestjs/schematics`, `@types/node`, `@nover-wrier/tsconfig`.
