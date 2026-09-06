/**
 * @file workspace.service.ts
 * @description Service managing isolated filesystem workspaces for autonomous novel generation sessions.
 * Implements the Black Box Engine isolation pattern by cloning the immutable base engine template
 * into tenant-scoped active directories while strictly preventing path traversal, disk exhaustion,
 * and multi-instance race conditions across shared Docker volumes.
 *
 * @security-architecture
 * - OWASP API6 (Broken Object Level / Business Flow Access): Enforces strict regex validation on novel identifiers
 *   to eliminate directory traversal attacks (e.g., `../../`, null bytes, control characters).
 * - Path Boundary Enforcement: Resolves canonical paths and strictly verifies that tenant directories remain
 *   jailed within the configured active workspaces directory.
 * - OWASP API4 (Unrestricted Resource Consumption): Tracks in-flight cloning operations and rejects requests
 *   exceeding the concurrent clone threshold to protect disk I/O and prevent event-loop starvation.
 * - Black Box Integrity: Strictly accesses the template directory as read-only, never mutating engine sources.
 * - Distributed Race Condition Mitigation: Leverages atomic filesystem directory creation (fs.mkdir exclusive flag)
 *   to prevent duplicate simultaneous workspace creation across horizontally scaled server containers sharing a volume.
 * - Pseudo-Atomic Transactions: Clones into a sibling temporary directory (`<novelId>.tmp`) on the same filesystem
 *   before performing an atomic rename, ensuring failure resilience and preventing half-written states (EXDEV-safe).
 * - Environment Agnosticism: Dynamically resolves filesystem roots from process.cwd() or container configuration,
 *   preventing absolute host path disclosures.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	BadRequestException,
	ConflictException,
	HttpException,
	HttpStatus,
	Injectable,
	InternalServerErrorException,
	Logger,
	type OnModuleInit,
} from "@nestjs/common";

/**
 * What it is: Data transfer object representing the result of a workspace initialization operation.
 * Why/How it is used: Returned by WorkspaceService.initialize to communicate the canonical filesystem path,
 * tenant novel identifier, and whether the workspace was newly cloned or previously existed.
 * Security: Exposes only sanitized, validated paths inside the tenant sandbox without revealing host system details.
 */
export interface WorkspaceInitResult {
	readonly workspacePath: string;
	readonly alreadyExisted: boolean;
	readonly novelId: string;
	readonly durationMs?: number;
}

/**
 * What it is: Abstraction contract for filesystem operations utilized by WorkspaceService.
 * Why/How it is used: Enables dependency injection and deterministic mocking in unit/integration test suites
 * without mutating global Node modules.
 * Security: Constrains filesystem manipulation to verified service operations and guarantees deterministic error simulation.
 */
export interface FileSystemOperations {
	readonly cp: typeof fs.cp;
	readonly mkdir: typeof fs.mkdir;
	readonly rename: typeof fs.rename;
	readonly stat: typeof fs.stat;
	readonly rm: typeof fs.rm;
}

/**
 * What it is: Configuration options for customizing WorkspaceService instantiation.
 * Why/How it is used: Allows overriding base paths, template paths, concurrency thresholds, and filesystem adapters
 * for testing, custom volume mounts, and multi-tenant sandboxing.
 * Security: Validates and binds dynamic path anchors relative to process.cwd() or container volume mounts without hardcoded host roots.
 */
export interface WorkspaceServiceOptions {
	readonly basePath?: string;
	readonly templatePath?: string;
	readonly maxConcurrentClones?: number;
	readonly fsOps?: Partial<FileSystemOperations>;
}

/**
 * What it is: Service managing isolated session workspaces and the Black Box Engine cloning lifecycle.
 * Why/How it is used: Injected as an internal provider for orchestration modules (Terminal Gateway, Background Queue)
 * to safely duplicate immutable templates into active tenant directories.
 * Security: Enforces path containment, concurrency throttling, read-only template consumption, and distributed atomic folder locking.
 */
@Injectable()
export class WorkspaceService implements OnModuleInit {
	private readonly logger = new Logger(WorkspaceService.name);

	/**
	 * Whitelist regex: Alphanumeric characters, dashes, and underscores only, length 1 to 128.
	 * Explicitly rejects directory traversal sequences (e.g., `..`, `/`, `\`), path separators, and null bytes.
	 */
	private static readonly NOVEL_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

	private readonly baseWorkspacesDir: string;
	private readonly activeWorkspacesDir: string;
	private readonly completedWorkspacesDir: string;
	private readonly templatePath: string;
	private readonly maxConcurrentClones: number;
	private readonly fsOps: FileSystemOperations;

	private activeClonesCount = 0;

	/**
	 * What it is: Initializes the WorkspaceService with configurable directory paths and concurrency gates.
	 * Why/How it is used: Injected by NestJS IoC container; resolves runtime directory anchors dynamically from
	 * environment variables (`WORKSPACE_BASE_PATH`, `ENGINE_TEMPLATE_PATH`, `MAX_CONCURRENT_CLONES`) or default workspace paths.
	 * Security: Resolves all paths relative to monorepo root (process.cwd()) without exposing host absolute paths.
	 *
	 * @param options - Optional overrides for testing and custom mounts.
	 */
	constructor(options?: WorkspaceServiceOptions) {
		this.fsOps = {
			cp: options?.fsOps?.cp ?? fs.cp,
			mkdir: options?.fsOps?.mkdir ?? fs.mkdir,
			rename: options?.fsOps?.rename ?? fs.rename,
			stat: options?.fsOps?.stat ?? fs.stat,
			rm: options?.fsOps?.rm ?? fs.rm,
		};

		const resolvedBasePath =
			options?.basePath ??
			process.env.WORKSPACE_BASE_PATH ??
			path.resolve(process.cwd(), "workspaces");

		this.baseWorkspacesDir = path.resolve(resolvedBasePath);
		this.activeWorkspacesDir = path.resolve(this.baseWorkspacesDir, "active");
		this.completedWorkspacesDir = path.resolve(
			this.baseWorkspacesDir,
			"completed",
		);

		const defaultTemplate = path.resolve(process.cwd(), "engine/template");
		this.templatePath = path.resolve(
			options?.templatePath ??
				process.env.ENGINE_TEMPLATE_PATH ??
				defaultTemplate,
		);

		const parsedMaxClones = Number.parseInt(
			process.env.MAX_CONCURRENT_CLONES ?? "5",
			10,
		);
		this.maxConcurrentClones =
			options?.maxConcurrentClones ??
			(Number.isNaN(parsedMaxClones) ? 5 : parsedMaxClones);
	}

	/**
	 * What it is: Lifecycle hook verifying filesystem readiness upon application bootstrap.
	 * Why/How it is used: Ensures source template exists and creates the target active and completed directories.
	 * Security: Validates that the engine template exists and is readable before accepting any user sessions.
	 */
	async onModuleInit(): Promise<void> {
		await this.verifyTemplateIntegrity();
		await this.fsOps.mkdir(this.activeWorkspacesDir, { recursive: true });
		await this.fsOps.mkdir(this.completedWorkspacesDir, { recursive: true });
	}

	/**
	 * What it is: Verifies that the source engine template directory exists and is a readable directory.
	 * Why/How it is used: Early detection on container boot to satisfy Edge Cases & Failure States in the blueprint.
	 * Security: Ensures server does not boot into an invalid state that would fail downstream clones midway.
	 */
	async verifyTemplateIntegrity(): Promise<void> {
		try {
			const stats = await this.fsOps.stat(this.templatePath);
			if (!stats.isDirectory()) {
				throw new Error(
					`Template path '${this.templatePath}' is not a directory.`,
				);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: "error",
					context: "WorkspaceService",
					event: "template_source_unreachable",
					templatePath: this.templatePath,
					error: message,
				}),
			);
			throw new InternalServerErrorException(
				`Source engine template directory is missing or unreadable: ${this.templatePath}`,
			);
		}
	}

	/**
	 * What it is: Validates novel identifier format and enforces path containment boundaries.
	 * Why/How it is used: Invoked prior to every filesystem operation involving tenant identifiers.
	 * Security: Protects against OWASP API6 path traversal attacks by rejecting path separators, dot-dot sequences,
	 * and verifying that the canonical resolved path resides strictly inside `workspaces/active/`.
	 *
	 * @param novelId - The client-provided novel identifier.
	 * @returns The strictly validated, canonical workspace path.
	 */
	public resolveAndValidateActivePath(novelId: string): string {
		if (
			typeof novelId !== "string" ||
			!WorkspaceService.NOVEL_ID_REGEX.test(novelId)
		) {
			this.logger.warn(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: "warn",
					context: "WorkspaceService",
					event: "workspace_invalid_novel_id",
					novelId,
				}),
			);
			throw new BadRequestException(
				`Invalid novel identifier '${novelId}'. Must be alphanumeric with dashes or underscores (1-128 chars).`,
			);
		}

		const targetPath = path.resolve(this.activeWorkspacesDir, novelId);
		const expectedPrefix = path.resolve(this.activeWorkspacesDir) + path.sep;

		if (!targetPath.startsWith(expectedPrefix)) {
			this.logger.warn(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: "warn",
					context: "WorkspaceService",
					event: "workspace_path_traversal_blocked",
					novelId,
					attemptedPath: targetPath,
				}),
			);
			throw new BadRequestException("Cross-tenant path traversal detected.");
		}

		return targetPath;
	}

	/**
	 * What it is: Programmatic internal API to initialize an isolated workspace directory for a novel.
	 * Why/How it is used: Called by upstream modules (Terminal Gateway, Background Queue) when a session begins.
	 * Security: Implements strict concurrency throttling (API4), idempotency, transaction boundaries via temporary folder
	 * and atomic rename (EXDEV-safe), distributed cross-instance race condition guards via atomic exclusive folder creation,
	 * graceful degradation on disk exhaustion (ENOSPC), and structured audit logging.
	 *
	 * @param novelId - Unique identifier for the novel session.
	 * @param correlationId - Optional correlation ID propagated from upstream request/event.
	 * @returns WorkspaceInitResult containing canonical path, existence flag, and novel identifier.
	 */
	async initialize(
		novelId: string,
		correlationId?: string,
	): Promise<WorkspaceInitResult> {
		const startTime = Date.now();
		const targetPath = this.resolveAndValidateActivePath(novelId);

		// 1. Idempotency Check: return cleanly if session directory already exists
		try {
			const stats = await this.fsOps.stat(targetPath);
			if (stats.isDirectory()) {
				const durationMs = Date.now() - startTime;
				this.logger.log(
					JSON.stringify({
						timestamp: new Date().toISOString(),
						level: "info",
						context: "WorkspaceService",
						event: "workspace_already_exists",
						novelId,
						correlationId,
						workspacePath: targetPath,
						durationMs,
					}),
				);
				return {
					workspacePath: targetPath,
					alreadyExisted: true,
					novelId,
				};
			}
		} catch (error: unknown) {
			const err = error as NodeJS.ErrnoException;
			if (err.code !== "ENOENT") {
				throw error;
			}
		}

		// 2. Concurrency Gating (OWASP API4): Throttles simultaneous clone operations per node
		if (this.activeClonesCount >= this.maxConcurrentClones) {
			this.logger.warn(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: "warn",
					context: "WorkspaceService",
					event: "workspace_concurrency_limit_exceeded",
					novelId,
					correlationId,
					activeClonesCount: this.activeClonesCount,
					maxConcurrentClones: this.maxConcurrentClones,
				}),
			);
			throw new HttpException(
				`Maximum concurrent workspace clone limit (${this.maxConcurrentClones}) exceeded.`,
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}

		// 3. Distributed Race Condition Guard & Transaction Boundary:
		// Atomic folder creation using fs.mkdir with exclusive flag (recursive: false)
		// on the shared filesystem volume (workspaces/active/<novelId>.tmp).
		// Across horizontally scaled nodes, exactly one node succeeds in creating this folder;
		// all concurrent callers fail with EEXIST and are safely rejected.
		const tempPath = path.resolve(this.activeWorkspacesDir, `${novelId}.tmp`);

		await this.fsOps.mkdir(this.activeWorkspacesDir, { recursive: true });

		try {
			// Exclusive atomic directory creation at OS kernel/filesystem level
			await this.fsOps.mkdir(tempPath);
		} catch (mkdirError: unknown) {
			const err = mkdirError as NodeJS.ErrnoException;
			if (err.code === "EEXIST") {
				// Re-verify if target completed in the interim
				if (await this.workspaceExists(novelId)) {
					const durationMs = Date.now() - startTime;
					this.logger.log(
						JSON.stringify({
							timestamp: new Date().toISOString(),
							level: "info",
							context: "WorkspaceService",
							event: "workspace_already_exists",
							novelId,
							correlationId,
							workspacePath: targetPath,
							durationMs,
						}),
					);
					return {
						workspacePath: targetPath,
						alreadyExisted: true,
						novelId,
					};
				}

				this.logger.warn(
					JSON.stringify({
						timestamp: new Date().toISOString(),
						level: "warn",
						context: "WorkspaceService",
						event: "workspace_concurrent_duplicate_request",
						novelId,
						correlationId,
						tempPath,
					}),
				);
				throw new ConflictException(
					`Workspace initialization for novel ID '${novelId}' is already in progress.`,
				);
			}
			throw mkdirError;
		}

		this.activeClonesCount++;

		try {
			// Native Node recursive copy from read-only engine template
			await this.fsOps.cp(this.templatePath, tempPath, {
				recursive: true,
				dereference: false,
				errorOnExist: false,
			});

			// Atomic rename within identical parent filesystem (EXDEV-safe)
			await this.fsOps.rename(tempPath, targetPath);

			const durationMs = Date.now() - startTime;
			this.logger.log(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: "info",
					context: "WorkspaceService",
					event: "workspace_initialized",
					novelId,
					correlationId,
					workspacePath: targetPath,
					durationMs,
				}),
			);

			return {
				workspacePath: targetPath,
				alreadyExisted: false,
				novelId,
				durationMs,
			};
		} catch (error: unknown) {
			// Rollback temporary directory on error to prevent lingering corrupted states
			try {
				await this.fsOps.rm(tempPath, {
					recursive: true,
					force: true,
				});
			} catch {
				// Best-effort cleanup
			}

			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOSPC") {
				this.logger.error(
					JSON.stringify({
						timestamp: new Date().toISOString(),
						level: "error",
						context: "WorkspaceService",
						event: "workspace_disk_exhausted",
						novelId,
						correlationId,
						error: "No space left on device (ENOSPC)",
					}),
				);
				throw new HttpException(
					"Insufficient disk space to initialize novel workspace.",
					HttpStatus.INSUFFICIENT_STORAGE,
				);
			}

			this.logger.error(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: "error",
					context: "WorkspaceService",
					event: "workspace_clone_failed",
					novelId,
					correlationId,
					error: err.message,
				}),
			);
			throw error;
		} finally {
			this.activeClonesCount--;
		}
	}

	/**
	 * What it is: Convenience alias for initialize.
	 * Why/How it is used: Supports callers using initializeWorkspace naming conventions.
	 * Security: Delegates directly to initialize() with all security guarantees preserved.
	 *
	 * @param novelId - Unique identifier for the novel session.
	 * @param correlationId - Optional correlation ID.
	 */
	async initializeWorkspace(
		novelId: string,
		correlationId?: string,
	): Promise<WorkspaceInitResult> {
		return this.initialize(novelId, correlationId);
	}

	/**
	 * What it is: Convenience alias for createSessionWorkspace.
	 * Why/How it is used: Supports modular caller naming conventions across feature blueprints.
	 * Security: Delegates directly to initialize() with all security guarantees preserved.
	 *
	 * @param novelId - Unique identifier for the novel session.
	 * @param correlationId - Optional correlation ID.
	 */
	async createSessionWorkspace(
		novelId: string,
		correlationId?: string,
	): Promise<WorkspaceInitResult> {
		return this.initialize(novelId, correlationId);
	}

	/**
	 * What it is: Getter returning the count of currently active in-flight clone operations.
	 * Why/How it is used: Exposed for health telemetry, monitoring metrics, and unit test assertions.
	 * Security: Read-only primitive value preventing state tampering.
	 */
	get activeClones(): number {
		return this.activeClonesCount;
	}

	/**
	 * What it is: Checks if an active workspace exists for a given novel identifier.
	 * Why/How it is used: Polled by status queries and downstream orchestrators before spawning processes.
	 * Security: Strictly validates novelId format before querying filesystem.
	 *
	 * @param novelId - Unique novel identifier.
	 * @returns True if active directory exists and is a directory.
	 */
	async workspaceExists(novelId: string): Promise<boolean> {
		const targetPath = this.resolveAndValidateActivePath(novelId);
		try {
			const stats = await this.fsOps.stat(targetPath);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * What it is: Resolves the canonical path of an active workspace.
	 * Why/How it is used: Injected as working directory (`cwd`) for PTY terminal and BullMQ worker processes.
	 * Security: Strictly validates novelId format to prevent directory traversal.
	 *
	 * @param novelId - Unique novel identifier.
	 * @returns Canonical active workspace path string.
	 */
	getWorkspacePath(novelId: string): string {
		return this.resolveAndValidateActivePath(novelId);
	}

	/**
	 * What it is: Archives an active workspace to the completed directory.
	 * Why/How it is used: Invoked after book compilation artifacts are validated and generation completes.
	 * Security: Strictly validates novelId and ensures target directory resides in workspaces/completed/.
	 *
	 * @param novelId - Unique novel identifier.
	 * @param correlationId - Optional correlation tracking ID.
	 * @returns Canonical path to archived completed directory.
	 */
	async archiveSessionWorkspace(
		novelId: string,
		correlationId?: string,
	): Promise<string> {
		const sourcePath = this.resolveAndValidateActivePath(novelId);
		const completedPath = path.resolve(this.completedWorkspacesDir, novelId);
		const expectedPrefix = path.resolve(this.completedWorkspacesDir) + path.sep;

		if (!completedPath.startsWith(expectedPrefix)) {
			throw new BadRequestException(
				"Cross-tenant archival path traversal detected.",
			);
		}

		await this.fsOps.mkdir(this.completedWorkspacesDir, {
			recursive: true,
		});
		await this.fsOps.rename(sourcePath, completedPath);

		this.logger.log(
			JSON.stringify({
				timestamp: new Date().toISOString(),
				level: "info",
				context: "WorkspaceService",
				event: "workspace_archived",
				novelId,
				correlationId,
				archivedPath: completedPath,
			}),
		);

		return completedPath;
	}
}
