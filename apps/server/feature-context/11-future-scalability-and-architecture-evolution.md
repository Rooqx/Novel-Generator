# Feature Context: Future Scalability & Architecture Evolution

**Section:** 11  
**Module Alignment:** SaaS Evolution, Cloud Sandboxing, Enterprise Storage  
**Status:** Canonical Reference  

---

## 1. Evolutionary SaaS Architecture

The platform prototype is designed with strict modular separation to ensure that moving from a single containerized VPS deployment to a multi-tenant cloud SaaS platform requires zero restructuring of core application contracts.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CURRENT PROTOTYPE                               │
│  - Local Disk Workspaces (`workspaces/active/`, `workspaces/completed/`)    │
│  - File-Based State (`planning/*.json`, `sync-state.sh`)                    │
│  - Single Host BullMQ Processor (`concurrency: 1`)                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                               Evolutionary Path
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENTERPRISE SAAS PRODUCTION                          │
│                                                                             │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐  │
│  │   State Migration     │  │   Compute Decoupling  │  │ Object Storage  │  │
│  │ PostgreSQL / Supabase │  │   Modal / E2B Workers │  │ AWS S3 / R2     │  │
│  │ Direct ORM Models     │  │   Ephemeral Sandboxes │  │ Signed URLs     │  │
│  └───────────────────────┘  └───────────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Evolution Vectors

### 2.1 State Migration (File JSON ➔ Relational Database)
* **Current State:** The novel engine uses JSON tracking files (`planning/*.json`) synchronized via shell scripts (`sync-state.sh`) and local file writes.
* **SaaS Production Architecture:**
  * Replace shell synchronizers with direct ORM repository calls (e.g., Prisma, Drizzle, or TypeORM in NestJS).
  * Migrate state tracking into a relational database (PostgreSQL / Supabase):
    * `Novels` table: Title, genre, premise, overall status, author ID.
    * `Blueprints` table: Acts, character bibles, worldbuilding rules, outline beats.
    * `Chapters` table: Chapter number, title, draft content, word counts, audit status.
  * **Zero Contract Breakage:** The shared interfaces in `@nover-wrier/types` (`NovelState`, `ChapterMeta`) remain the exact same contract consumed by the frontend and backend.

### 2.2 Compute Decoupling (Local Container ➔ Cloud Micro-VM Sandboxes)
* **Current State:** The BullMQ worker runs directly on the VPS host with a local concurrency limit (`concurrency: 1`), executing bash scripts inside `workspaces/active/`.
* **SaaS Production Architecture:**
  * Decouple execution into on-demand, ephemeral micro-VM sandboxes (e.g., **Modal**, **E2B**, or **AWS ECS Fargate**).
  * The BullMQ processor acts as an orchestration dispatcher rather than a local compute host:
    1. Provisions an isolated ephemeral sandbox per novel session.
    2. Injects the engine template and authentication keys.
    3. Streams execution telemetry back to Redis over WebSocket webhooks.
    4. Automatically destroys the VM once `make_books.py` produces artifacts.
  * **Benefits:** Unlimited horizontal scalability, complete process-level isolation between users, and zero host CPU/RAM exhaustion risks.

### 2.3 Multi-Tenant Object Storage (Local Disks ➔ S3 / Cloudflare R2)
* **Current State:** Completed book artifacts are stored in `workspaces/completed/<novel-id>/manuscript/` on the local filesystem and served via `BooksController`.
* **SaaS Production Architecture:**
  * Post-compilation, the worker automatically uploads the generated `.epub`, `.docx`, and `.md` files to an S3-compatible object store (e.g., **AWS S3**, **Cloudflare R2**, or **Google Cloud Storage**).
  * `BooksController.downloadBook` generates secure, time-limited presigned download URLs:
    ```typescript
    @Get(':id/download/:format')
    async getDownloadUrl(@Param('id') id: string, @Param('format') format: string) {
      const presignedUrl = await this.storageService.getPresignedUrl(id, format);
      return { downloadUrl: presignedUrl, expiresAt: Date.now() + 3600000 };
    }
    ```
  * **Benefits:** Eliminates local disk capacity constraints, lowers server bandwidth costs via CDN edge caching, and provides enterprise durability for generated manuscripts.
