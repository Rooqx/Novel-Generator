# Feature Context: Book Compilation & Artifact Delivery

**Section:** 9  
**Module Alignment:** `apps/server/src/modules/books/`, Pandoc & Python Compilation Pipeline  
**Status:** Canonical Reference  

---

## 1. Feature Lifecycle & Completion Trigger

The compilation and artifact delivery pipeline represents the culminating phase of the novel platform lifecycle. Once every planned chapter has been drafted and validated for continuity, the raw text is transformed into reader-ready publication formats.

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Autonomous Drafting Concludes                            │
│    All planned chapters written to `manuscript/chapters/`   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Trigger Document Compiler                                │
│    Execute `python3 make_books.py` inside session directory │
└──────────────────────────────┬──────────────────────────────┘
                               │
               Pandoc / Markdown Parser Execution
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Artifact Harvesting in `manuscript/`                     │
│    - `novel.epub` (e-reader standard)                       │
│    - `novel.docx` (editor/print format)                     │
│    - `novel.md`   (clean markdown bundle)                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Archival & Delivery Notification                         │
│    - Copy session to `workspaces/completed/<novel-id>/`     │
│    - Emit `SocketServerEvent.GENERATION_COMPLETED`          │
│    - Frontend renders `BookExportModal.tsx`                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Download Endpoints Served by BooksController             │
│    `GET /api/novels/:id/download/:format`                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Compilation Engine (`make_books.py`)

The platform leverages the engine's built-in Python compilation pipeline without modifying its internal scripts:

### 2.1 Execution Invocation
Inside `GeneratorProcessor`, once the final chapter passes verification:
```bash
python3 make_books.py
```
* **Working Directory:** Set strictly to the active workspace (`workspaces/active/<novel-id>/`).
* **Environment Dependencies:** Requires Python 3.10+ and system `pandoc` binary pre-installed in the container.

### 2.2 Compilation Outputs
`make_books.py` iterates over ordered chapter markdown files, builds frontmatter/table-of-contents, and invokes Pandoc to generate:
* **EPUB (`.epub`):** Standard publication format compatible with Apple Books, Kindle, and e-readers.
* **DOCX (`.docx`):** Formatted Word document for editorial revisions and formatting tweaks.
* **Markdown (`.md`):** Complete, unified raw manuscript bundle.

---

## 3. Serving Layer (`BooksController` & `BooksService`)

The NestJS backend includes a dedicated `BooksModule` to validate, stream, and deliver compiled book artifacts securely.

### 3.1 Download Endpoint Contract
```typescript
@Controller('api/novels')
export class BooksController {
  @Get(':id/download/:format')
  async downloadBook(
    @Param('id') id: string,
    @Param('format') format: 'epub' | 'pdf' | 'docx' | 'markdown',
    @Res() res: Response,
  ) {
    // Validates existence, sets Content-Disposition header, and streams file
  }
}
```

### 3.2 Output Validation & Security
Before serving files, `BooksService`:
1. Checks whether the novel is located in `workspaces/completed/<novel-id>/` (fallback to `workspaces/active/<novel-id>/`).
2. Validates that requested format matches allowed types (`epub`, `docx`, `pdf`, `markdown`).
3. Prevents path traversal vulnerabilities by resolving strict absolute paths within the novel's `manuscript/` directory.
4. Sets the proper MIME type headers:
   * `application/epub+zip` for EPUB
   * `application/vnd.openxmlformats-officedocument.wordprocessingml.document` for DOCX
   * `text/markdown` for Markdown
   * `application/pdf` for PDF

---

## 4. Delivery Event & UI Export Modal

Upon successful compilation and archival:
1. The backend worker emits a `generation:completed` event over WebSockets containing download links.
2. The Astro reader interface displays the export dialog (`BookExportModal.tsx`).
3. Authors can download their preferred formats with one click or open the browser reader view.
