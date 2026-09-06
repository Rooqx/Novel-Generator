/**
 * @file workspace.service.spec.ts
 * @description Comprehensive unit tests for WorkspaceService covering path traversal mitigation,
 * concurrency throttling, idempotency, atomic transactional directory cloning, and ENOSPC degradation.
 *
 * @security-architecture
 * - Tests OWASP API6 path traversal rejections against traversal strings, null bytes, and absolute escapes.
 * - Tests OWASP API4 concurrency gating ensuring requests are throttled when active limit is breached.
 * - Tests Black Box Engine immutability ensuring source template is strictly read-only.
 * - Tests atomic rename and rollback cleanup upon simulated copy interrupts.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	BadRequestException,
	ConflictException,
	HttpException,
	HttpStatus,
	InternalServerErrorException,
} from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceService } from "./workspace.service";

describe("WorkspaceService", () => {
	let testRootDir: string;
	let testTemplateDir: string;
	let testWorkspacesDir: string;
	let service: WorkspaceService;

	beforeEach(async () => {
		// Create isolated temporary directory fixture for each test run
		testRootDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "nover-workspace-test-"),
		);
		testTemplateDir = path.join(testRootDir, "engine", "template");
		testWorkspacesDir = path.join(testRootDir, "workspaces");

		// Seed a dummy black-box template
		await fs.mkdir(path.join(testTemplateDir, "manuscript"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(testTemplateDir, "AGENTS.md"),
			"# Base Engine Prompt\nImmutable content",
			"utf-8",
		);
		await fs.writeFile(
			path.join(testTemplateDir, "manuscript", "metadata.json"),
			JSON.stringify({ title: "Template" }),
			"utf-8",
		);

		service = new WorkspaceService({
			basePath: testWorkspacesDir,
			templatePath: testTemplateDir,
			maxConcurrentClones: 2,
		});

		await service.onModuleInit();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		try {
			await fs.rm(testRootDir, { recursive: true, force: true });
		} catch {
			// Cleanup best-effort
		}
	});

	describe("Path Resolution & Host Agnosticism (Secrets Handling)", () => {
		it("resolves workspaces relative to the configured base path without leaking host paths", () => {
			const validId = "novel_session_001";
			const resolvedPath = service.getWorkspacePath(validId);
			expect(resolvedPath).toBe(
				path.resolve(testWorkspacesDir, "active", validId),
			);
			expect(resolvedPath.startsWith(testRootDir)).toBe(true);
		});
	});

	describe("OWASP API6: Path Traversal & Novel ID Validation", () => {
		it.each([
			"../../etc/passwd",
			"../escaped",
			"novel/subfolder",
			"novel\\windows",
			"novel\0nullbyte",
			"novel;rm -rf",
			"novel space",
			"",
			"   ",
			"a".repeat(129), // Exceeds max length of 128
		])("rejects malicious or invalid novel ID '%s'", (maliciousId) => {
			expect(() => service.resolveAndValidateActivePath(maliciousId)).toThrow(
				BadRequestException,
			);
		});

		it.each([
			"valid-novel-id-123",
			"novel_uuid_456",
			"0123456789",
			"a-b_c",
			"f47ac10b-58cc-4372-a567-0e02b2c3d479",
		])("accepts compliant novel ID '%s'", (validId) => {
			expect(() => service.resolveAndValidateActivePath(validId)).not.toThrow();
		});
	});

	describe("Black Box Cloning & Directory Isolation", () => {
		it("safely clones engine template to workspaces/active/<novelId> leaving template untouched", async () => {
			const novelId = "novel-uuid-101";
			const result = await service.initialize(novelId, "corr-101");

			expect(result.novelId).toBe(novelId);
			expect(result.alreadyExisted).toBe(false);
			expect(result.workspacePath).toBe(
				path.join(testWorkspacesDir, "active", novelId),
			);

			// Verify cloned files exist
			const clonedAgentsFile = path.join(result.workspacePath, "AGENTS.md");
			const clonedMetadata = path.join(
				result.workspacePath,
				"manuscript",
				"metadata.json",
			);
			const agentsContent = await fs.readFile(clonedAgentsFile, "utf-8");
			expect(agentsContent).toContain("Immutable content");

			const metadataContent = await fs.readFile(clonedMetadata, "utf-8");
			expect(JSON.parse(metadataContent)).toEqual({ title: "Template" });

			// Verify source template remains unchanged and accessible
			const sourceAgentsContent = await fs.readFile(
				path.join(testTemplateDir, "AGENTS.md"),
				"utf-8",
			);
			expect(sourceAgentsContent).toBe(agentsContent);
		});
	});

	describe("Reliability: Idempotency", () => {
		it("returns clean success without overwriting when called repeatedly", async () => {
			const novelId = "idempotent-novel-001";

			// First initialization
			const firstCall = await service.initialize(novelId, "corr-first");
			expect(firstCall.alreadyExisted).toBe(false);

			// Write a custom file into the active workspace to verify it is NOT overwritten
			const sessionNotePath = path.join(
				firstCall.workspacePath,
				"session_notes.txt",
			);
			await fs.writeFile(sessionNotePath, "Draft in progress", "utf-8");

			// Second initialization (idempotent duplicate via initialize)
			const secondCall = await service.initialize(novelId, "corr-second");
			expect(secondCall.alreadyExisted).toBe(true);
			expect(secondCall.workspacePath).toBe(firstCall.workspacePath);

			// Third initialization (idempotent duplicate via initializeWorkspace alias)
			const thirdCall = await service.initializeWorkspace(
				novelId,
				"corr-third",
			);
			expect(thirdCall.alreadyExisted).toBe(true);
			expect(thirdCall.workspacePath).toBe(firstCall.workspacePath);

			// Verify existing files were preserved without partial overwriting
			const preservedNote = await fs.readFile(sessionNotePath, "utf-8");
			expect(preservedNote).toBe("Draft in progress");
		});
	});

	describe("Race Condition Guard", () => {
		it("prevents simultaneous duplicate initialization calls for the same novel ID", async () => {
			const novelId = "concurrent-novel-race";

			const delayedService = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: testTemplateDir,
				maxConcurrentClones: 2,
				fsOps: {
					cp: async (...args) => {
						await new Promise((resolve) => setTimeout(resolve, 50));
						return fs.cp(...args);
					},
				},
			});

			const call1 = delayedService.initialize(novelId, "req-1");
			const call2 = delayedService.initialize(novelId, "req-2");

			const results = await Promise.allSettled([call1, call2]);

			// One call succeeds, and the concurrent collision throws ConflictException
			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");

			expect(fulfilled.length).toBe(1);
			expect(rejected.length).toBe(1);
			if (rejected[0].status === "rejected") {
				expect(rejected[0].reason).toBeInstanceOf(ConflictException);
			}
		});

		it("prevents race conditions across separate service instances sharing the same volume via atomic fs.mkdir", async () => {
			const novelId = "cross-instance-shared-volume-race";

			// Simulate Node Container 1 with slight I/O delay
			const containerNode1 = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: testTemplateDir,
				fsOps: {
					cp: async (...args) => {
						await new Promise((resolve) => setTimeout(resolve, 50));
						return fs.cp(...args);
					},
				},
			});

			// Simulate Node Container 2 sharing the exact same filesystem volume
			const containerNode2 = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: testTemplateDir,
			});

			const callNode1 = containerNode1.initialize(novelId, "node-1-req");
			const callNode2 = containerNode2.initialize(novelId, "node-2-req");

			const results = await Promise.allSettled([callNode1, callNode2]);

			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");

			expect(fulfilled.length).toBe(1);
			expect(rejected.length).toBe(1);
			if (rejected[0].status === "rejected") {
				expect(rejected[0].reason).toBeInstanceOf(ConflictException);
			}
		});
	});

	describe("OWASP API4: Concurrency Limit Throttling", () => {
		it("rejects new clone requests when active clone limit is exceeded", async () => {
			let releaseClone: () => void = () => {};
			const cloneBarrier = new Promise<void>((resolve) => {
				releaseClone = resolve;
			});

			const controlledService = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: testTemplateDir,
				maxConcurrentClones: 2,
				fsOps: {
					cp: async () => {
						await cloneBarrier;
					},
				},
			});

			const req1 = controlledService.initialize("concurrency-novel-1", "req-1");
			const req2 = controlledService.initialize("concurrency-novel-2", "req-2");

			// Allow in-flight registrations
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Third simultaneous clone must be throttled with HTTP 429
			await expect(
				controlledService.initialize("concurrency-novel-3", "req-3"),
			).rejects.toThrow(HttpException);

			try {
				await controlledService.initialize("concurrency-novel-3", "req-3");
			} catch (error: unknown) {
				const httpError = error as HttpException;
				expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
			}

			// Release blocked clones
			releaseClone?.();
			await Promise.all([req1, req2]);
		});
	});

	describe("Graceful Degradation & Atomic Cleanup on Error", () => {
		it("cleans up temporary directory and handles simulated copy interrupt", async () => {
			const novelId = "interrupted-novel";
			const failingService = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: testTemplateDir,
				fsOps: {
					cp: async () => {
						throw new Error("Simulated I/O Interrupt during copy");
					},
				},
			});

			await expect(
				failingService.initialize(novelId, "req-int"),
			).rejects.toThrow("Simulated I/O Interrupt during copy");

			// Verify destination target was not created
			const exists = await failingService.workspaceExists(novelId);
			expect(exists).toBe(false);

			// Verify no lingering .tmp directories remain
			const activeFiles = await fs.readdir(
				path.join(testWorkspacesDir, "active"),
			);
			const tmpFiles = activeFiles.filter((f) => f.includes(".tmp"));
			expect(tmpFiles.length).toBe(0);
		});

		it("handles ENOSPC (disk full) gracefully and maps to INSUFFICIENT_STORAGE", async () => {
			const novelId = "enospc-novel";
			const enospcError = Object.assign(new Error("No space left on device"), {
				code: "ENOSPC",
			});
			const enospcService = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: testTemplateDir,
				fsOps: {
					cp: async () => {
						throw enospcError;
					},
				},
			});

			await expect(
				enospcService.initialize(novelId, "req-enospc"),
			).rejects.toThrowError(HttpException);

			try {
				await enospcService.initialize(novelId, "req-enospc-2");
			} catch (err: unknown) {
				const httpErr = err as HttpException;
				expect(httpErr.getStatus()).toBe(HttpStatus.INSUFFICIENT_STORAGE);
			}
		});
	});

	describe("Boot Template Verification Failure State", () => {
		it("throws InternalServerErrorException if engine template directory is missing", async () => {
			const invalidService = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: path.join(testRootDir, "non_existent_template"),
			});

			await expect(invalidService.verifyTemplateIntegrity()).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	describe("Archival Flow", () => {
		it("archives active workspace to completed directory", async () => {
			const novelId = "archive-novel";
			await service.initialize(novelId);

			const completedPath = await service.archiveSessionWorkspace(
				novelId,
				"corr-archive",
			);
			expect(completedPath).toBe(
				path.join(testWorkspacesDir, "completed", novelId),
			);

			const existsActive = await service.workspaceExists(novelId);
			expect(existsActive).toBe(false);

			const completedStats = await fs.stat(completedPath);
			expect(completedStats.isDirectory()).toBe(true);
		});
	});

	describe("Performance Budget (p95 <= 200ms)", () => {
		it("completes clone operation under the 200ms budget limit", async () => {
			const novelId = "perf-budget-novel";
			const start = Date.now();
			const result = await service.initialize(novelId, "perf-test-corr");
			const durationMs = Date.now() - start;

			expect(result.alreadyExisted).toBe(false);
			expect(durationMs).toBeLessThan(200);
		});
	});
});
