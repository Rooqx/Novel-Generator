/**
 * Canonical real-time WebSocket event contracts and payload definitions.
 * Governs bidirectional streaming between the Astro web client and NestJS gateway.
 */

/**
 * Client-initiated WebSocket events emitted to the backend gateway.
 */
export enum SocketClientEvent {
	TERMINAL_INPUT = "terminal:input",
	TERMINAL_RESIZE = "terminal:resize",
	PLAN_APPROVE = "plan:approve",
	GENERATION_START = "generation:start",
}

/**
 * Server-emitted WebSocket events streamed downstream to the web client.
 */
export enum SocketServerEvent {
	TERMINAL_OUTPUT = "terminal:output",
	MODE_SWITCHED = "mode:switched",
	GENERATION_PROGRESS = "generation:progress",
	GENERATION_COMPLETED = "generation:completed",
	GENERATION_FAILED = "generation:failed",
}

/**
 * Payload for upstream user keystrokes and inputs piped into PTY stdin.
 */
export interface TerminalInputPayload {
	novelId: string;
	data: string;
}

/**
 * Payload for terminal window geometry adjustments.
 */
export interface TerminalResizePayload {
	novelId: string;
	cols: number;
	rows: number;
}

/**
 * Payload for raw terminal output chunks emitted downstream to the browser terminal.
 */
export interface TerminalOutputPayload {
	novelId: string;
	data: string;
}

/**
 * Payload for author approval of the narrative blueprint to trigger mode transition.
 */
export interface PlanApprovalPayload {
	novelId: string;
	outlineId?: string;
	approved: boolean;
	notes?: string;
}

/**
 * Payload emitted when OpenCode switches operational mode (e.g., Plan -> Build via Tab).
 */
export interface ModeSwitchedPayload {
	novelId: string;
	mode: "plan" | "build";
	timestamp: string;
}

/**
 * Payload emitted during background chapter drafting to reflect progress.
 */
export interface GenerationProgressPayload {
	novelId: string;
	chapterIndex: number;
	totalChapters: number;
	percentage: number;
	statusMessage: string;
}

/**
 * Payload emitted upon successful book compilation and artifact harvesting.
 */
export interface GenerationCompletedPayload {
	novelId: string;
	outputPath: string;
	formats: ("epub" | "docx" | "md")[];
	completedAt: string;
}

/**
 * Payload emitted when autonomous generation encounters an unrecoverable failure.
 */
export interface GenerationFailedPayload {
	novelId: string;
	error: string;
	failedAt: string;
}
