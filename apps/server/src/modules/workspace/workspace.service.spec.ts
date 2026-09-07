import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	BadRequestException,
	ConflictException,
	type HttpException,
	HttpStatus,
	InternalServerErrorException,
	Logger,
} from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceService } from "./workspace.service";

describe("WorkspaceService", () => {
	let testRootDir: string;
	let testTemplateDir: string;
	let testWorkspacesDir: string;
	let service: WorkspaceService;

	beforeEach(async () => {
		testRootDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "workspace-service-test-"),
		);
		testTemplateDir = path.join(testRootDir, "engine", "template");
		testWorkspacesDir = path.join(testRootDir, "workspaces");

		// Seed dummy immutable engine template directory
		await fs.mkdir(path.join(testTemplateDir, "manuscript", "chapters"), {
			recursive: true,
		});
		await fs.mkdir(path.join(testTemplateDir, "planning"), { recursive: true });
		await fs.writeFile(
			path.join(testTemplateDir, "AGENTS.md"),
			"# Agents Prompt Template",
			"utf-8",
		);
		await fs.writeFile(
			path.join(testTemplateDir, "planning", "novel-outline.json"),
			JSON.stringify({ title: "Template Novel", chapters: [] }),
			"utf-8",
		);

		service = new WorkspaceService({
			basePath: testWorkspacesDir,
			templatePath: testTemplateDir,
			maxConcurrentClones: 3,
		});

		await service.onModuleInit();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		try {
			await fs.rm(testRootDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup
		}
	});

	describe("OWASP API1: Broken Object Level Authorization & Path Traversal Guards", () => {
		it("rejects novelId containing relative path traversal (../)", async () => {
			await expect(service.initialize("../../etc/passwd")).rejects.toThrow(
				BadRequestException,
			);
			await expect(service.initialize("valid/../invalid")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("rejects novelId containing forward slashes or backslashes", async () => {
			await expect(service.initialize("novel/subfolder")).rejects.toThrow(
				BadRequestException,
			);
			await expect(service.initialize("novel\\subfolder")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("rejects novelId containing illegal characters or empty string", async () => {
			await expect(service.initialize("")).rejects.toThrow(BadRequestException);
			await expect(service.initialize("novel;rm -rf /")).rejects.toThrow(
				BadRequestException,
			);
			await expect(service.initialize("novel$name")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("allows valid alphanumeric, hyphen, and underscore novel IDs", async () => {
			const validId = "novel_session-1234_abc";
			const result = await service.initialize(validId);
			expect(result.alreadyExisted).toBe(false);
			expect(result.novelId).toBe(validId);
		});
	});

	describe("Idempotent Workspace Provisioning & Usage Tracking", () => {
		it("provisions a new workspace on first call and returns existing on second call", async () => {
			const novelId = "idempotent-novel-001";
			const logSpy = vi.spyOn(Logger.prototype, "log");

			const firstCall = await service.initialize(novelId, "corr-first");
			expect(firstCall.alreadyExisted).toBe(false);
			expect(firstCall.workspacePath).toBe(
				path.join(testWorkspacesDir, "active", novelId),
			);

			// Verify template files were cloned
			const outlineContent = await fs.readFile(
				path.join(firstCall.workspacePath, "planning", "novel-outline.json"),
				"utf-8",
			);
			expect(outlineContent).toContain("Template Novel");

			// Verify prototype_session_started was logged exactly once
			const startedLogs = logSpy.mock.calls.filter((call) => {
				try {
					const parsed = JSON.parse(call[0] as string);
					return parsed.event === "prototype_session_started";
				} catch {
					return false;
				}
			});
			expect(startedLogs.length).toBe(1);

			// Modify workspace to ensure idempotent call does NOT overwrite
			const notePath = path.join(firstCall.workspacePath, "note.txt");
			await fs.writeFile(notePath, "user draft notes", "utf-8");

			// Second initialize call
			const secondCall = await service.initialize(novelId, "corr-second");
			expect(secondCall.alreadyExisted).toBe(true);
			expect(secondCall.workspacePath).toBe(firstCall.workspacePath);

			// Verify custom file was not overwritten
			const preservedNote = await fs.readFile(notePath, "utf-8");
			expect(preservedNote).toBe("user draft notes");

			// Verify prototype_session_started was NOT logged again
			const startedLogsAfter = logSpy.mock.calls.filter((call) => {
				try {
					const parsed = JSON.parse(call[0] as string);
					return parsed.event === "prototype_session_started";
				} catch {
					return false;
				}
			});
			expect(startedLogsAfter.length).toBe(1);
		});
	});

	describe("OWASP API4: Concurrency Limit Throttling", () => {
		it("rejects requests exceeding MAX_CONCURRENT_CLONES with HTTP 429", async () => {
			let releaseClone: () => void = () => {};
			const barrier = new Promise<void>((resolve) => {
				releaseClone = resolve;
			});

			const throttledService = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: testTemplateDir,
				maxConcurrentClones: 2,
				fsOps: {
					cp: async () => {
						await barrier;
					},
				},
			});

			const req1 = throttledService.initialize("concurrent-1", "c-1");
			const req2 = throttledService.initialize("concurrent-2", "c-2");

			await new Promise((resolve) => setTimeout(resolve, 10));

			// Third simultaneous call must be rejected with 429
			try {
				await throttledService.initialize("concurrent-3", "c-3");
				expect.fail("Expected 429 HttpException");
			} catch (err: unknown) {
				const httpErr = err as HttpException;
				expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
			}

			releaseClone();
			await Promise.all([req1, req2]);
		});
	});

	describe("Race Condition Guard & Atomic OS Rename", () => {
		it("prevents simultaneous duplicate initializations with ConflictException", async () => {
			const novelId = "race-novel";
			const raceService = new WorkspaceService({
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

			const call1 = raceService.initialize(novelId, "r-1");
			const call2 = raceService.initialize(novelId, "r-2");

			const results = await Promise.allSettled([call1, call2]);
			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");

			expect(fulfilled.length).toBe(1);
			expect(rejected.length).toBe(1);
			if (rejected[0].status === "rejected") {
				expect(rejected[0].reason).toBeInstanceOf(ConflictException);
			}
		});
	});

	describe("Graceful Degradation & Atomic Cleanup on Error", () => {
		it("cleans up temporary directory on copy interrupt", async () => {
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
				failingService.initialize(novelId, "corr-int"),
			).rejects.toThrow("Simulated I/O Interrupt during copy");

			const exists = await failingService.workspaceExists(novelId);
			expect(exists).toBe(false);

			const activeFiles = await fs.readdir(
				path.join(testWorkspacesDir, "active"),
			);
			const tmpFiles = activeFiles.filter((f) => f.includes(".tmp"));
			expect(tmpFiles.length).toBe(0);
		});

		it("maps ENOSPC error to 507 INSUFFICIENT_STORAGE", async () => {
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

			try {
				await enospcService.initialize(novelId, "corr-enospc");
				expect.fail("Expected 507 HttpException");
			} catch (err: unknown) {
				const httpErr = err as HttpException;
				expect(httpErr.getStatus()).toBe(HttpStatus.INSUFFICIENT_STORAGE);
			}
		});
	});

	describe("Boot Template Verification (OWASP API8)", () => {
		it("throws InternalServerErrorException on boot if template is missing", async () => {
			const missingService = new WorkspaceService({
				basePath: testWorkspacesDir,
				templatePath: path.join(testRootDir, "non_existent_template"),
			});

			await expect(missingService.verifyTemplateIntegrity()).rejects.toThrow(
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

		it("rejects path traversal during archival", async () => {
			await expect(
				service.archiveSessionWorkspace("../../evil"),
			).rejects.toThrow(BadRequestException);
		});
	});

	describe("Performance & Path Resolution", () => {
		it("executes initialize under the 200ms p95 latency budget", async () => {
			const novelId = "perf-novel";
			const start = Date.now();
			const result = await service.initialize(novelId);
			const durationMs = Date.now() - start;

			expect(result.alreadyExisted).toBe(false);
			expect(durationMs).toBeLessThan(200);
		});

		it("getWorkspacePath returns canonical active path", () => {
			const novelId = "get-path-novel";
			const resolvedPath = service.getWorkspacePath(novelId);
			expect(resolvedPath).toBe(
				path.join(testWorkspacesDir, "active", novelId),
			);
		});
	});
});
