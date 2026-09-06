# Feature Context: Queue-Driven Background Generation Engine

**Section:** 8  
**Module Alignment:** `apps/server/src/modules/generator/`, Redis, BullMQ  
**Status:** Canonical Reference  

---

## 1. Decoupled Background Architecture

Manuscript drafting across multiple chapters is an extended, computationally intensive process that may take minutes or hours. Coupling manuscript generation to an active HTTP request or persistent client WebSocket connection introduces severe failure modes: network dropouts, browser refreshes, or accidental tab closures will kill the drafting process.

To guarantee reliability, Phase 2 is entirely **decoupled** from client session persistence through **BullMQ** task queues backed by an in-memory **Redis** broker:

```
┌─────────────────────────────────┐
│     Client WebSocket Trigger    │
│      (Mode Switch / Start)      │
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│         GeneratorQueue          │
│   `generationQueue.add(...)`    │
└────────────────┬────────────────┘
                 │
           Redis Broker
     Queue: 'novel-generation'
                 │
┌────────────────▼────────────────┐
│       GeneratorProcessor        │
│      Worker Host Thread         │
│  `@Processor({ concurrency: 1})`│
└────────────────┬────────────────┘
                 │
      Workspace Inspection & Loop
  `workspaces/active/<novel-id>/`
                 │
         make_books.py
                 │
┌────────────────▼────────────────┐
│   Completion / Archival Emit    │
│   `workspaceService.archive()`  │
└─────────────────────────────────┘
```

---

## 2. Job Enqueueing & Data Contracts

When the planning phase concludes and the user approves the narrative blueprint, `GeneratorQueue` dispatches a strongly-typed job to the queue:

### 2.1 Job Payload Schema
```json
{
  "novelId": "uuid-v4",
  "sessionPath": "/workspaces/active/uuid-v4",
  "config": {
    "title": "The Glass Citadel",
    "genre": "Science Fiction",
    "targetChapters": 12,
    "targetWordsPerChapter": 3000,
    "timestamp": "2026-09-06T12:00:00Z"
  }
}
```

### 2.2 Retry & Backoff Semantics
* **Attempts:** 3 retries configured on unexpected process terminations.
* **Backoff:** Exponential backoff (`delay: 5000ms`) prevents overloading inference endpoints during rate-limit events.
* **Persistence:** Completed and failed jobs are retained in Redis for auditing and progress retrieval.

---

## 3. Host Resource Throttling & Concurrency Control

Autonomous AI agents generate rapid tool executions, heavy AST operations, and intensive Python compilation cycles. Running unbounded parallel workers on a single VPS or container host can cause CPU starvation and Out-of-Memory (OOM) kills.

### 3.1 Strict Concurrency Limits
The BullMQ processor enforces deterministic concurrency constraints:
```typescript
@Processor('novel-generation', { concurrency: 1 })
export class GeneratorProcessor extends WorkerHost {
  // Processes jobs sequentially to guarantee system stability
}
```
* On containerized host instances, `concurrency: 1` ensures dedicated CPU/RAM access per running novel drafting pipeline.
* Additional novel requests queue up deterministically without starving the active pipeline.
* In enterprise scaling scenarios, concurrency can be tuned via container environment variables (`GENERATOR_CONCURRENCY`).

---

## 4. Lifecycle Monitoring & Progress Telemetry

The processor continuously observes filesystem state inside `workspaces/active/<novel-id>/` and surfaces telemetry:

### 4.1 Progress Milestones
* **0% - 10%:** Session verification and directory structure initialization (`manuscript/chapters/`).
* **10% - 80%:** Chapter generation monitoring (polling `manuscript/chapters/chapter_*.md` and `planning/state.json`).
* **80% - 95%:** Book compilation execution via `python3 make_books.py`.
* **95% - 100%:** Final verification, archiving workspace to `workspaces/completed/<novel-id>/`, and notifying the client.

### 4.2 Telemetry Event Contract
The worker emits structured progress payloads over Redis pub/sub and WebSocket gateways:
```typescript
export interface GenerationProgressPayload {
  novelId: string;
  currentChapter: number;
  totalChapters: number;
  chapterTitle?: string;
  percent: number;
  statusText: string;
}
```
If a user reconnects after hours away, the frontend queries `GET /api/novels/:id/status` to instantly rehydrate the progress dashboard.
