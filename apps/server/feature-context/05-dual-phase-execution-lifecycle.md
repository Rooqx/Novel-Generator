# Feature Context: Dual-Phase Execution Lifecycle

**Section:** 5  
**Module Alignment:** Cross-Phase State Engine, `terminal` & `generator` modules  
**Status:** Canonical Reference  

---

## 1. Lifecycle Overview & Phase Separation

The platform organizes the end-to-end novel creation lifecycle into two fundamentally distinct operational phases characterized by opposing execution profiles and infrastructure requirements:

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

---

## 2. Phase Breakdown & Execution Profiles

### 2.1 Phase 1: Real-Time Interactive Planning
* **Execution Paradigm:** Synchronous, low-latency, human-in-the-loop session.
* **Underlying Engine Mode:** `Plan Mode`.
* **Transport:** Bidirectional WebSocket stream directly connected to a POSIX pseudo-terminal (`node-pty`).
* **Frontend Surface:** Astro page `/novel/[id]/plan` mounting the xterm.js React terminal island (`XtermTerminal.tsx`) and plan approval controls.
* **Core Objectives:**
  1. Conduct the structured narrative interview based on user premise and genre.
  2. Synthesize character profile bibles (`characters/*.md`) and worldbuilding rules (`worldbuilding/*.md`).
  3. Formulate the dynamic narrative arc and chapter outline (`planning/*.json`).
  4. Present choices and decisions to the author in real time.
* **State Boundaries:** File writes during Plan Mode are restricted to planning schemas and narrative blueprints; no prose chapters are drafted yet.

### 2.2 Phase 2: Asynchronous Queue-Driven Generation
* **Execution Paradigm:** Asynchronous, decoupled, headless batch processing.
* **Underlying Engine Mode:** `Build Mode`.
* **Transport:** BullMQ task processor managed by Redis; progress pushed via WebSocket/polling events.
* **Frontend Surface:** Astro page `/novel/[id]/build` showing live drafting progress bars, chapter completion feeds, and reading previews.
* **Core Objectives:**
  1. Sequentially draft every planned chapter into `manuscript/chapters/`.
  2. Perform cross-chapter continuity audits, tone checks, and pacing reconciliations.
  3. Update tracking metadata (`planning/state.json`).
  4. Trigger the compilation pipeline (`python3 make_books.py`) once all chapters are finalized.
* **Client Resilience:** Users can safely disconnect, navigate away, or close browser tabs without interrupting or corrupting the background drafting loop.

---

## 3. Dynamic Story Dimensions

Unlike rigid generator tools that enforce arbitrary story lengths, this platform treats story dimensions as **fully configurable runtime parameters**:

### 3.1 Dynamic Parameter Configuration
* **Story Length & Chapter Counts:** Determined during Phase 1 planning rather than hardcoded at the infrastructure level. A user can create a 5-chapter novella or a 40-chapter epic fantasy.
* **Act & Beat Structures:** Flexible 3-act, 4-act, or hero's journey narrative frameworks negotiated interactively during planning.
* **Word Count Targets:** Configurable per-chapter and total word targets passed through session configuration.

### 3.2 Blueprint Enforcement
* The AI planner establishes the chapter blueprint during Phase 1 based on user inputs.
* Phase 2 executes the blueprint deterministically, verifying each chapter against its planned beats before declaring generation complete.
