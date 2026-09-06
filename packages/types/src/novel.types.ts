/**
 * Core domain types and state definitions for the autonomous novel generation platform.
 * Establishes the canonical in-memory and file-based state representations shared
 * between the Astro client and NestJS server.
 */

/**
 * Execution phases of a novel generation lifecycle.
 * Used across the Astro frontend, NestJS backend, and BullMQ background worker.
 */
export enum NovelStatus {
	IDLE = "idle",
	PLANNING = "planning",
	PLAN_READY = "plan_ready",
	BUILDING = "building",
	COMPILING = "compiling",
	COMPLETED = "completed",
	FAILED = "failed",
}

/**
 * Progress and status for individual manuscript chapters.
 */
export interface ChapterMeta {
	chapterNumber: number;
	title: string;
	targetWords?: number;
	wordCount?: number;
	status: "pending" | "drafting" | "completed" | "failed";
	path?: string;
	summary?: string;
	completedAt?: string;
}

/**
 * Dynamic story dimensions and session execution configuration.
 * Treated as runtime parameters rather than hardcoded infrastructure limits.
 */
export interface SessionConfig {
	title: string;
	genre: string;
	premise?: string;
	targetChapters: number;
	targetWordsPerChapter: number;
	totalWordTarget?: number;
	actStructure?: string;
	modelProfile?: {
		planModel?: string;
		buildModel?: string;
	};
	timestamp?: string;
}

/**
 * Holistic state definition for an active or completed novel project.
 * Synchronized across WebSocket streams and persisted in session tracking files.
 */
export interface NovelState {
	novelId: string;
	status: NovelStatus;
	sessionPath: string;
	config: SessionConfig;
	chapters: ChapterMeta[];
	currentChapterIndex?: number;
	progressPercentage?: number;
	outlineId?: string;
	errorMessage?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Shape of headless runtime credentials and infrastructure environment variables.
 * OWASP API8: Types define the shape of config objects without hardcoding secrets or default values.
 */
export interface EnvironmentConfig {
	OPENCODE_API_KEY?: string;
	OPENROUTER_API_KEY?: string;
	GEMINI_API_KEY?: string;
	REDIS_HOST?: string;
	REDIS_PORT?: string;
	PORT?: string;
	NODE_ENV?: "development" | "production" | "test";
}
