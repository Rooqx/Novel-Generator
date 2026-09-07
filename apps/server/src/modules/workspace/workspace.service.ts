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

const DEFAULT_MAX_CONCURRENT_CLONES = 3;
const NOVEL_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export interface FileSystemOperations {
	cp: (
		source: string,
		destination: string,
		opts?: {
			recursive?: boolean;
			dereference?: boolean;
			errorOnExist?: boolean;
		},
	) => Promise<void>;
	mkdir: (
		dirPath: string,
		opts?: { recursive?: boolean },
	) => Promise<string | undefined>;
	rename: (oldPath: string, newPath: string) => Promise<void>;
	rm: (
		targetPath: string,
		opts?: { recursive?: boolean; force?: boolean },
	) => Promise<void>;
	stat: (targetPath: string) => Promise<{ isDirectory: () => boolean }>;
	access: (targetPath: string, mode?: number) => Promise<void>;
}

export interface WorkspaceServiceOptions {
	basePath?: string;
	templatePath?: string;
	maxConcurrentClones?: number;
	fsOps?: Partial<FileSystemOperations>;
}

export interface WorkspaceInitResult {
	workspacePath: string;
	alreadyExisted: boolean;
	novelId: string;
	durationMs?: number;
}

/**
 * Manages sandboxed filesystem environments per novel session.
 * Clones the immutable engine template into workspaces/active/<novelId>/
 * while enforcing tenant path isolation, concurrency throttling, and atomic transactions.
 */
@Injectable()
export class WorkspaceService implements OnModuleInit {
	private readonly logger = new Logger(WorkspaceService.name);
	private readonly activeWorkspacesDir: string;
	private readonly completedWorkspacesDir: string;
	private readonly templatePath: string;
	private readonly maxConcurrentClones: number;
	private readonly fsOps: FileSystemOperations;
	private activeClonesCount = 0;

	constructor(options: WorkspaceServiceOptions = {}) {
		const rootPath = process.cwd();
		const baseWorkspaces =
			options.basePath ??
			process.env.WORKSPACE_BASE_PATH ??
			path.resolve(rootPath, "workspaces");

		this.activeWorkspacesDir = path.resolve(baseWorkspaces, "active");
		this.completedWorkspacesDir = path.resolve(baseWorkspaces, "completed");
		this.templatePath =
			options.templatePath ??
			process.env.ENGINE_TEMPLATE_PATH ??
			path.resolve(rootPath, "engine", "template");

		this.maxConcurrentClones =
			options.maxConcurrentClones ??
			(process.env.MAX_CONCURRENT_CLONES
				? Number.parseInt(process.env.MAX_CONCURRENT_CLONES, 10)
				: DEFAULT_MAX_CONCURRENT_CLONES);

		this.fsOps = {
			cp: (src, dest, opts) => fs.cp(src, dest, opts),
			mkdir: (dir, opts) => fs.mkdir(dir, opts),
			rename: (oldP, newP) => fs.rename(oldP, newP),
			rm: (target, opts) => fs.rm(target, opts),
			stat: (target) => fs.stat(target),
			access: (target, mode) => fs.access(target, mode),
			...options.fsOps,
		};
	}

	async onModuleInit(): Promise<void> {
		await this.verifyTemplateIntegrity();
	}

	/**
	 * Fast-fails server startup if the engine template is missing or unreadable,
	 * preventing silent runtime clone failures (OWASP API8).
	 */
	async verifyTemplateIntegrity(): Promise<void> {
		try {
			const stats = await this.fsOps.stat(this.templatePath);
			if (!stats.isDirectory()) {
				throw new Error(
					`Template path '${this.templatePath}' is not a directory.`,
				);
			}
			await this.fsOps.access(this.templatePath, 4); // 4 = R_OK
			this.logEvent(
				"info",
				"template_integrity_verified",
				undefined,
				undefined,
				{
					templatePath: this.templatePath,
				},
			);
		} catch (error: unknown) {
			const err = error as Error;
			this.logEvent(
				"error",
				"template_integrity_verification_failed",
				undefined,
				undefined,
				{ templatePath: this.templatePath, error: err.message },
			);
			throw new InternalServerErrorException(
				`Workspace service initialization failed: Engine template directory '${this.templatePath}' is unreadable or missing.`,
			);
		}
	}

	get activeClones(): number {
		return this.activeClonesCount;
	}

	private validateNovelId(novelId: string): void {
		if (
			!novelId ||
			typeof novelId !== "string" ||
			!NOVEL_ID_REGEX.test(novelId) ||
			novelId.includes("..") ||
			novelId.includes("/") ||
			novelId.includes("\\")
		) {
			throw new BadRequestException(
				"Invalid novel identifier format. Must match alphanumeric, hyphen, or underscore characters without path traversal.",
			);
		}
	}

	private resolveAndValidateActivePath(novelId: string): string {
		this.validateNovelId(novelId);
		const resolved = path.resolve(this.activeWorkspacesDir, novelId);
		const expectedPrefix = path.resolve(this.activeWorkspacesDir) + path.sep;

		if (!resolved.startsWith(expectedPrefix)) {
			throw new BadRequestException(
				"Cross-tenant directory traversal attempt blocked.",
			);
		}
		return resolved;
	}

	private resolveAndValidateCompletedPath(novelId: string): string {
		this.validateNovelId(novelId);
		const resolved = path.resolve(this.completedWorkspacesDir, novelId);
		const expectedPrefix = path.resolve(this.completedWorkspacesDir) + path.sep;

		if (!resolved.startsWith(expectedPrefix)) {
			throw new BadRequestException(
				"Cross-tenant archival path traversal detected.",
			);
		}
		return resolved;
	}

	private acquireCloneSlot(novelId: string, correlationId?: string): void {
		if (this.activeClonesCount >= this.maxConcurrentClones) {
			this.logEvent(
				"warn",
				"workspace_concurrency_limit_exceeded",
				novelId,
				correlationId,
				{
					activeClonesCount: this.activeClonesCount,
					maxConcurrentClones: this.maxConcurrentClones,
				},
			);
			throw new HttpException(
				`Maximum concurrent workspace clone limit (${this.maxConcurrentClones}) exceeded.`,
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}
		this.activeClonesCount++;
	}

	private releaseCloneSlot(): void {
		this.activeClonesCount--;
	}

	private async ensureTempDirExclusive(
		tempPath: string,
		novelId: string,
		correlationId?: string,
	): Promise<boolean> {
		try {
			await this.fsOps.mkdir(tempPath);
			return false;
		} catch (mkdirError: unknown) {
			const err = mkdirError as NodeJS.ErrnoException;
			if (err.code === "EEXIST") {
				if (await this.workspaceExists(novelId)) {
					return true;
				}
				this.logEvent(
					"warn",
					"workspace_concurrent_duplicate_request",
					novelId,
					correlationId,
					{ tempPath },
				);
				throw new ConflictException(
					`Workspace initialization for novel ID '${novelId}' is already in progress.`,
				);
			}
			throw mkdirError;
		}
	}

	private async performAtomicClone(
		tempPath: string,
		targetPath: string,
		novelId: string,
		correlationId?: string,
	): Promise<void> {
		try {
			await this.fsOps.cp(this.templatePath, tempPath, {
				recursive: true,
				dereference: false,
				errorOnExist: false,
			});
			await this.fsOps.rename(tempPath, targetPath);
		} catch (error: unknown) {
			try {
				await this.fsOps.rm(tempPath, { recursive: true, force: true });
			} catch {
				// Best-effort cleanup of temp artifacts
			}

			const err = error as NodeJS.ErrnoException;
			if (err.code === "ENOSPC") {
				this.logEvent(
					"error",
					"workspace_disk_exhausted",
					novelId,
					correlationId,
					{
						error: "No space left on device (ENOSPC)",
					},
				);
				throw new HttpException(
					"Insufficient disk space to initialize novel workspace.",
					HttpStatus.INSUFFICIENT_STORAGE,
				);
			}

			this.logEvent("error", "workspace_clone_failed", novelId, correlationId, {
				error: err.message,
			});
			throw error;
		}
	}

	private logEvent(
		level: "info" | "warn" | "error",
		event: string,
		novelId?: string,
		correlationId?: string,
		extra?: Record<string, unknown>,
	): void {
		const payload = {
			timestamp: new Date().toISOString(),
			level,
			context: "WorkspaceService",
			event,
			novelId,
			correlationId,
			...extra,
		};
		const json = JSON.stringify(payload);
		if (level === "error") {
			this.logger.error(json);
		} else if (level === "warn") {
			this.logger.warn(json);
		} else {
			this.logger.log(json);
		}
	}

	async workspaceExists(novelId: string): Promise<boolean> {
		const targetPath = this.resolveAndValidateActivePath(novelId);
		try {
			const stats = await this.fsOps.stat(targetPath);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	getWorkspacePath(novelId: string): string {
		return this.resolveAndValidateActivePath(novelId);
	}

	/**
	 * Provisions an isolated workspace for the novel session idempotently.
	 * Emits prototype_session_started exactly once when creating a new workspace.
	 */
	async initialize(
		novelId: string,
		correlationId?: string,
	): Promise<WorkspaceInitResult> {
		const startTime = Date.now();
		const targetPath = this.resolveAndValidateActivePath(novelId);

		if (await this.workspaceExists(novelId)) {
			const durationMs = Date.now() - startTime;
			this.logEvent(
				"info",
				"workspace_already_exists",
				novelId,
				correlationId,
				{
					workspacePath: targetPath,
					durationMs,
				},
			);
			return {
				workspacePath: targetPath,
				alreadyExisted: true,
				novelId,
				durationMs,
			};
		}

		this.acquireCloneSlot(novelId, correlationId);

		try {
			await this.fsOps.mkdir(this.activeWorkspacesDir, { recursive: true });
			const tempPath = path.resolve(this.activeWorkspacesDir, `${novelId}.tmp`);

			const completedInInterim = await this.ensureTempDirExclusive(
				tempPath,
				novelId,
				correlationId,
			);
			if (completedInInterim) {
				const durationMs = Date.now() - startTime;
				return {
					workspacePath: targetPath,
					alreadyExisted: true,
					novelId,
					durationMs,
				};
			}

			await this.performAtomicClone(
				tempPath,
				targetPath,
				novelId,
				correlationId,
			);
			const durationMs = Date.now() - startTime;

			this.logEvent("info", "workspace_initialized", novelId, correlationId, {
				workspacePath: targetPath,
				durationMs,
			});
			this.logEvent(
				"info",
				"prototype_session_started",
				novelId,
				correlationId,
			);

			return {
				workspacePath: targetPath,
				alreadyExisted: false,
				novelId,
				durationMs,
			};
		} finally {
			this.releaseCloneSlot();
		}
	}

	async initializeWorkspace(
		novelId: string,
		correlationId?: string,
	): Promise<WorkspaceInitResult> {
		return this.initialize(novelId, correlationId);
	}

	async createSessionWorkspace(
		novelId: string,
		correlationId?: string,
	): Promise<WorkspaceInitResult> {
		return this.initialize(novelId, correlationId);
	}

	async archiveSessionWorkspace(
		novelId: string,
		correlationId?: string,
	): Promise<string> {
		const sourcePath = this.resolveAndValidateActivePath(novelId);
		const completedPath = this.resolveAndValidateCompletedPath(novelId);

		await this.fsOps.mkdir(this.completedWorkspacesDir, { recursive: true });
		await this.fsOps.rename(sourcePath, completedPath);

		this.logEvent("info", "workspace_archived", novelId, correlationId, {
			archivedPath: completedPath,
		});

		return completedPath;
	}
}
