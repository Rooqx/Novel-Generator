# Feature Context: Container Environment & Session Isolation

**Section:** 3  
**Module Alignment:** `apps/server/src/modules/workspace/`, Docker Toolchain  
**Status:** Canonical Reference  

---

## 1. Container Architecture & System Toolchain

The execution environment is encapsulated in a single, reproducible Linux container designed to provide all dependencies required by both the agent CLI (`opencode`) and the novel repository’s automation scripts.

### 1.1 Base System Specifications
* **Base Operating System:** Ubuntu 22.04 LTS (x86_64 or ARM64) / Debian Bookworm Slim.
* **Package Manager:** `pnpm` (v9+) activated via Node Corepack.
* **Multi-Container Services:**
  * `server`: NestJS backend orchestration service (Port 3000).
  * `redis`: BullMQ task queue broker (Port 6379, image `redis:7-alpine`).
  * `web`: Astro client application (Port 4321).

### 1.2 Primary Runtime Environments
1. **Node.js (LTS v20+ / v22):**
   * Executes the agent CLI (`opencode`).
   * Runs the NestJS orchestration backend and WebSocket gateway.
2. **Python 3 (3.10+):**
   * Executes repository automation scripts:
     * `make_books.py`: Compiles raw markdown chapters into final `.epub`, `.docx`, and `.md` manuscripts.
     * `automation/dashboard.py`: Renders novel drafting metrics and status.
     * `automation/system-health-check.sh`: Validates script readiness.

### 1.3 System Utilities & Native Compilers
* **`pandoc`:** Core dependency invoked by Python compilation pipelines for document conversion to EPUB and DOCX.
* **`build-essential`, `make`, `g++`:** Required C++ compiler toolchain to build native POSIX pseudo-terminal bindings for `node-pty`.
* **Standard Utilities:** `git`, `curl`, `ca-certificates`, `bash`.

---

## 2. Volume & Session Isolation Strategy

To support concurrent novel generation across multiple users without cross-talk or state pollution, the platform implements strict directory isolation:

```
workspaces/
├── active/
│   ├── novel-uuid-101/               # User session 1 isolated engine
│   │   ├── planning/
│   │   ├── characters/
│   │   ├── worldbuilding/
│   │   ├── manuscript/chapters/
│   │   └── make_books.py
│   └── novel-uuid-102/               # User session 2 isolated engine
│       └── ...
└── completed/
    └── novel-uuid-100/               # Archived finished novel with compiled outputs
        └── manuscript/
            ├── book.epub
            ├── book.docx
            └── novel.md
```

### 2.1 Engine Template Storage
* The canonical untouched novel writing engine template resides at `engine/template/`.
* The template contains baseline prompt blueprints (`AGENTS.md`, `CLAUDE.md`), automation shell scripts (`launch-novel.sh`, `sync-state.sh`), and markdown templates.
* The template is treated as read-only reference storage.

### 2.2 Runtime Session Cloning (`WorkspaceService`)
* For every new novel creation request, `workspace.service.ts` provisions a dedicated directory:
  ```
  workspaces/active/<novel-id>/
  ```
* The service recursively copies `engine/template/` into this session folder.
* **Concurrency Safety:** Every user session operates strictly within its own sandboxed root directory. No chapter files, JSON tracking files, or script executions can collide or overwrite another session.

### 2.3 Session Lifecycle & Archival
1. **Creation:** Upon session start, `WorkspaceService.createSessionWorkspace(novelId)` prepares the active directory.
2. **Execution:** The PTY process (`node-pty`) and background BullMQ worker set `cwd` to `workspaces/active/<novel-id>`.
3. **Completion & Archival:** When manuscript drafting finishes and `make_books.py` produces the book artifacts, `WorkspaceService.archiveSessionWorkspace(novelId)` copies the workspace to `workspaces/completed/<novel-id>/`.
4. **Cleanup:** Active session folders can be safely recycled or deleted once archived.
