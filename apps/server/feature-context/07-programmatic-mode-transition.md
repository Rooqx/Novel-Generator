# Feature Context: Programmatic Mode Transition

**Section:** 7  
**Module Alignment:** `apps/server/src/modules/terminal/terminal.service.ts`, `terminal.gateway.ts`  
**Status:** Canonical Reference  

---

## 1. Transition Lifecycle & User Trigger

The transition between Phase 1 (Interactive Planning) and Phase 2 (Autonomous Generation) is a critical state boundary that changes the agent's permissions, model profile, and operational behavior.

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User reviews outline cards & clicks:                     │
│    "Approve Plan & Start Writing" (PlanApprovalModal.tsx)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
               SocketClientEvent.PLAN_APPROVE
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Backend TerminalGateway intercepts event                 │
│    `terminalGateway.handlePlanApprove(payload)`             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                terminalService.switchToBuildMode(novelId)
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Inject ASCII Tab Character ('\t' / 0x09) into PTY stdin  │
│    `ptySession.ptyProcess.write('\t')`                      │
└──────────────────────────────┬──────────────────────────────┘
                               │
               OpenCode Toggles: Plan Mode ➔ Build Mode
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Notify Client & Dispatch Background BullMQ Job           │
│    Emit SocketServerEvent.MODE_SWITCHED                     │
└─────────────────────────────────────────────────────────────┘
```

### 1.1 Transition Trigger Mechanism
* The planning dialogue culminates in structured outline files saved inside `planning/*.json`.
* The frontend presents the narrative blueprint via interactive review cards (`OptionCard.tsx`) and confirmation modals (`PlanApprovalModal.tsx`).
* When the author approves the blueprint, the web client emits a typed `plan:approve` payload over the WebSocket connection:
  ```typescript
  export interface PlanApprovalPayload {
    novelId: string;
    outlineId?: string;
    approved: boolean;
    notes?: string;
  }
  ```

---

## 2. The Tab-Key Automation Mechanism

The OpenCode agent CLI natively switches between **Plan Mode** (read-only architectural analysis and planning) and **Build Mode** (full tool execution, file editing, and command execution) via the `Tab` keyboard shortcut.

### 2.1 Headless ASCII Injection
In a containerized cloud environment without physical keyboard hardware, the backend automates this transition programmatically:
* Upon validating the approval event, `TerminalService` locates the active PTY process associated with the `novelId`.
* It writes the raw ASCII horizontal tab control character (`\t` or hex byte `\x09`) into the PTY stream:
  ```typescript
  switchToBuildMode(novelId: string): void {
    const session = this.sessions.get(novelId);
    if (session) {
      this.logger.log(`Injecting Tab character to toggle Build Mode for novel: ${novelId}`);
      session.ptyProcess.write('\t');
    }
  }
  ```

### 2.2 Mode Switch Effects inside the Engine
Injecting the tab character triggers OpenCode's internal state machine:
1. **Model Switch:** Shifts active routing from the reasoning-heavy **Plan Mode Model** to the high-throughput **Build Mode Model**.
2. **Permission Unlocking:** Enables write access to the filesystem (`manuscript/chapters/`) and grants permission to run bash scripts (`launch-novel.sh`, `make_books.py`).
3. **Execution Mode Shift:** Transitions the agent from conversational Q&A to autonomous drafting loop execution.

### 2.3 Client Notification & Navigation
Once the mode switch is initiated:
* The server emits a `mode:switched` event containing the novel ID and timestamp.
* The frontend client redirects the user from `/novel/[id]/plan` to `/novel/[id]/build` to monitor autonomous chapter generation.
