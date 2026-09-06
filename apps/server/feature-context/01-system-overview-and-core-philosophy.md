# Feature Context: System Overview & Core Philosophy

**Section:** 1  
**Module Alignment:** Cross-Cutting / System-Wide Architecture  
**Status:** Canonical Reference  

---

## 1. Executive Summary

This specification defines the technical architecture for adapting the autonomous novel-writing repository into a multi-user, web-accessible platform. The platform enables users to interactively plan stories in real time, inspect narrative blueprints, and execute end-to-end manuscript drafting and compilation with zero human intervention during drafting.

The platform solves three core challenges:
1. **Interactive Planning to Autonomous Execution:** Bridging synchronous human-in-the-loop creative planning with long-running, asynchronous batch manuscript writing.
2. **Containerized Cloud Isolation:** Running CLI-driven AI workflows headlessly inside secure, reproducible container environments.
3. **Multi-Tenant Scalability:** Supporting concurrent user sessions without disk or process collisions while keeping the underlying engine code completely intact.

---

## 2. The "Black Box Engine" Principle

The foundational design tenet of this platform is the **Black Box Engine** pattern:

### 2.1 Zero Repo Modification
* The core novel-writing engine (prompts, directory structures, bash scripts, agents, and compilation pipelines) is treated as an **immutable, black-box orchestration engine**.
* The inner engine repository code located in `engine/template/` must never be altered directly by server code or client logic.
* All novel generation logic, narrative instructions (`AGENTS.md`, `CLAUDE.md`), automation scripts (`launch-novel.sh`, `sync-state.sh`, `make_books.py`), and template schemas remain strictly untouched.

### 2.2 Strict Separation of Concerns
* **Engine Responsibility:** Pure creative execution—character bibles, worldbuilding, planning state, scene drafting, continuity auditing, and book compilation.
* **Platform & Server Responsibility:** Outer infrastructure concerns—HTTP routing, WebSocket gateways, pseudo-terminal (PTY) spawning, process lifecycle management, background BullMQ queues, headless authentication injection, session isolation, and artifact harvesting.
* Decoupling ensures that updates to the novel engine do not break web platform code, and platform enhancements do not require modifying engine scripts.

### 2.3 System Extensibility & Dynamic Configuration
* The platform avoids hardcoding vendors, AI models, or story dimensions (such as fixed chapter counts, act numbers, or target word lengths).
* **Story Dimensions:** Dynamic runtime parameters established interactively during Phase 1 planning according to user preferences.
* **AI Providers:** Pluggable multi-provider architecture allowing runtime routing across OpenCode Zen, OpenRouter, Google AI Studio, Groq, Cerebras, and SambaNova.
* **Execution Modes:** Decoupled model routing between reasoning-intensive Plan Mode and high-throughput Build Mode.
