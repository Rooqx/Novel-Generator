# Feature Context: Real-Time Interactive Planning Bridge

**Section:** 6  
**Module Alignment:** `apps/server/src/modules/terminal/`, `apps/web/src/components/terminal/`  
**Status:** Canonical Reference  

---

## 1. Feature Architecture Overview

Phase 1 requires a low-latency, bidirectional interactive terminal stream between the web client and the autonomous agent CLI running inside the cloud sandbox. This bridge enables real-time narrative interviews, interactive multiple-choice story choices, and dynamic outline feedback.

```
┌─────────────────────────────────┐
│     Browser Client (Astro)      │
│  ┌───────────────────────────┐  │
│  │   XtermTerminal Island    │  │
│  │     (client:only="react") │  │
│  └─────────────┬─────────────┘  │
└────────────────┼────────────────┘
                 │
  WebSocket Transport (Socket.IO)
  Events: 'terminal:input', 'terminal:output', 'terminal:resize'
                 │
┌────────────────▼────────────────┐
│      NestJS Server Backend      │
│  ┌───────────────────────────┐  │
│  │      TerminalGateway      │  │
│  └─────────────┬─────────────┘  │
│  ┌─────────────▼─────────────┐  │
│  │      TerminalService      │  │
│  └─────────────┬─────────────┘  │
└────────────────┼────────────────┘
                 │
      POSIX Pseudo-Terminal (PTY)
      Spawned via `node-pty`
                 │
┌────────────────▼────────────────┐
│    Active Novel Workspace       │
│    `workspaces/active/<id>/`    │
│  ┌───────────────────────────┐  │
│  │     OpenCode / Bash CLI   │  │
│  │      (Plan Mode Model)    │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

---

## 2. Virtual PTY Management (`node-pty`)

Direct process spawning via standard `child_process.spawn` fails for interactive CLIs because it lacks a TTY context, dropping ANSI color escape sequences, arrow-key navigation, and interactive tab toggles.

### 2.1 PTY Instance Specification
The backend terminal service (`terminal.service.ts`) uses `node-pty` to spawn processes in a genuine pseudo-terminal context:
* **Terminal Type:** Emulates POSIX-compliant `xterm-256color`.
* **Geometry:** Default dimensions of 80 columns by 24 rows, dynamically resizable via incoming client resize payloads (`terminal:resize`).
* **Working Directory:** Set strictly to the isolated session directory: `workspaces/active/<novel-id>/`.
* **Environment Configuration:** Injects `TERM=xterm-256color`, `COLORTERM=truecolor`, and pre-seeded authentication variables (`OPENCODE_API_KEY`, etc.).

### 2.2 Output Capture & Escape Sequence Preservation
* Standard output (`stdout`) and standard error (`stderr`) are merged by the PTY layer without stripping ANSI escape sequences.
* Colors, bold text, cursor movement, and progress spinners render faithfully in the browser.

---

## 3. Bidirectional WebSocket Gateway

Managed by `@nestjs/websockets` leveraging `socket.io` for auto-reconnection and room-based session routing.

### 3.1 Downstream Stream (CLI ➔ Web UI)
* As the PTY generates chunks, `ptyProcess.onData` intercepts the raw string chunks.
* The gateway transmits `terminal:output` events directly to the novel's dedicated WebSocket room:
  ```typescript
  server.to(novelId).emit(SocketServerEvent.TERMINAL_OUTPUT, {
    novelId,
    data: outputData,
  });
  ```

### 3.2 Upstream Stream (Web UI ➔ CLI)
* User keystrokes, arrow keys, and text responses captured by the browser terminal are packaged into `terminal:input` events:
  ```typescript
  @SubscribeMessage(SocketClientEvent.TERMINAL_INPUT)
  handleInput(@MessageBody() payload: TerminalInputPayload) {
    this.terminalService.write(payload.novelId, payload.data);
  }
  ```
* The backend writes the payload directly into `ptySession.ptyProcess.write(payload.data)`.

---

## 4. Client Integration (Islands Architecture)

The frontend integrates the terminal using Astro's component islands pattern to guarantee optimal performance:

### 4.1 Static Shell with Zero Runtime JS
* Page scaffolding, navigation bars, headers, and meta tags are rendered as static Astro components (`.astro`) with zero initial client-side JavaScript.

### 4.2 Browser-Only Terminal Island (`client:only="react"`)
* Terminal emulation (`@xterm/xterm` + `@xterm/addon-fit`) requires direct access to browser DOM globals (`window`, `document`).
* Server-side rendering (SSR) of xterm would crash the build.
* Declaring `client:only="react"` bypasses SSR and renders the interactive terminal purely on the client:
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
