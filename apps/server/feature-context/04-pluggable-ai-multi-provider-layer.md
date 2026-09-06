# Feature Context: Pluggable AI Multi-Provider Layer

**Section:** 4  
**Module Alignment:** AI Gateway & Agent CLI Configuration (`opencode.json`, `auth.json`)  
**Status:** Canonical Reference  

---

## 1. Abstract Provider Architecture

The platform implements a multi-provider gateway rather than binding to a single AI vendor. The system communicates through OpenAI-compatible interfaces or unified agent gateways, supporting dynamic fallback and tiering across diverse inference providers:

```
                  ┌─────────────────────────────────────┐
                  │          Agent CLI Gateway          │
                  │           (OpenCode CLI)            │
                  └──────────────────┬──────────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│   OpenCode Zen     │    │    OpenRouter      │    │  Google AI Studio  │
│ Frontier Reasoning │    │ Fallback Pool & OS │    │ Massive Context    │
└────────────────────┘    └────────────────────┘    └────────────────────┘
           │                         │                         │
           └─────────────────────────┼─────────────────────────┘
                                     ▼
                          ┌────────────────────┐
                          │   Groq / Cerebras  │
                          │ Fast Scene Drafts  │
                          └────────────────────┘
```

### 1.1 Supported Provider Gateways
* **OpenCode Zen:** Unified gateway optimized for frontier reasoning and complex code/instruction execution.
* **OpenRouter:** Distributed pool of open-source and commercial models offering dynamic model fallback and tiering.
* **Google AI Studio:** High-throughput, large-context models (e.g., Gemini series) ideal for full-manuscript continuity analysis and large worldbuilding bibles.
* **Groq / Cerebras / SambaNova:** High-speed token inference engines utilized for rapid chapter drafting cycles during Build Mode.

---

## 2. Dual-Mode Model Routing Strategy

Operational requirements differ fundamentally between story planning and manuscript drafting. The platform decouples model selection by phase through `opencode.json`:

### 2.1 Plan Mode Model Configuration
* **Role:** Interactive worldbuilding, character psychological depth, plot arc structuring, narrative pacing rules, and dynamic outline creation.
* **Model Profile:** Deep reasoning models equipped with massive context windows (e.g., Gemini 1.5 Pro / Claude 3.5 Sonnet / reasoning-focused frontier models).
* **Key Attributes:**
  * High architectural coherence across long conversational turns.
  * Strict adherence to structured planning schemas (`planning/*.json`).
  * Complex constraint satisfaction across multiple narrative bibles.

### 2.2 Build Mode Model Configuration
* **Role:** Autonomous, repetitive scene prose generation, dialogue synthesis, chapter continuity verification, and stylistic prose consistency.
* **Model Profile:** Fast inference models with strong stylistic literary cadence and tight instruction-following (e.g., high-throughput models on Groq/Cerebras or fast frontier tiers).
* **Key Attributes:**
  * Rapid token generation throughput to write full chapters without timing out.
  * Literary cadence aligned with voice rules set in character files.
  * Deterministic execution of writing prompts and bash tool actions.

---

## 3. Headless Authentication & Key Management

When running inside headless cloud sandboxes, Docker containers, or VPS hosts, interactive authentication prompts (such as TUI `/connect` prompts or browser OAuth flows) will block execution and crash background tasks.

### 3.1 Environment Variable Injection
The backend container injects provider credentials directly into the child process environment:
* `OPENCODE_API_KEY`: Primary agent gateway access token.
* `OPENROUTER_API_KEY`: OpenRouter dynamic routing key.
* `GEMINI_API_KEY`: Google AI Studio direct access key.
* Provider-specific keys are passed down during process spawning in `terminal.service.ts` and `generator.processor.ts`.

### 3.2 Pre-Seeded Credential Manifest (`auth.json`)
If running in container environments without interactive shell persistence, credentials are pre-seeded at container boot into:
```
~/.local/share/opencode/auth.json
```
Example pre-seeded manifest structure:
```json
{
  "zen": {
    "key": "env:OPENCODE_API_KEY"
  },
  "openrouter": {
    "key": "env:OPENROUTER_API_KEY"
  },
  "google": {
    "key": "env:GEMINI_API_KEY"
  }
}
```
This guarantees that the OpenCode CLI boots directly into an active, authenticated state without waiting for user input.
