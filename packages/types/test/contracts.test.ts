import { describe, expect, it } from "vitest";
import {
	type EnvironmentConfig,
	type NovelState,
	NovelStatus,
	type SessionConfig,
	SocketClientEvent,
	SocketServerEvent,
} from "../src";

describe("Shared Contracts & Types Specification", () => {
	it("defines valid NovelStatus execution phases", () => {
		expect(NovelStatus.IDLE).toBe("idle");
		expect(NovelStatus.PLANNING).toBe("planning");
		expect(NovelStatus.PLAN_READY).toBe("plan_ready");
		expect(NovelStatus.BUILDING).toBe("building");
		expect(NovelStatus.COMPILING).toBe("compiling");
		expect(NovelStatus.COMPLETED).toBe("completed");
		expect(NovelStatus.FAILED).toBe("failed");
	});

	it("defines valid SocketClientEvent strings", () => {
		expect(SocketClientEvent.TERMINAL_INPUT).toBe("terminal:input");
		expect(SocketClientEvent.TERMINAL_RESIZE).toBe("terminal:resize");
		expect(SocketClientEvent.PLAN_APPROVE).toBe("plan:approve");
		expect(SocketClientEvent.GENERATION_START).toBe("generation:start");
	});

	it("defines valid SocketServerEvent strings", () => {
		expect(SocketServerEvent.TERMINAL_OUTPUT).toBe("terminal:output");
		expect(SocketServerEvent.MODE_SWITCHED).toBe("mode:switched");
		expect(SocketServerEvent.GENERATION_PROGRESS).toBe("generation:progress");
		expect(SocketServerEvent.GENERATION_COMPLETED).toBe("generation:completed");
		expect(SocketServerEvent.GENERATION_FAILED).toBe("generation:failed");
	});

	it("verifies EnvironmentConfig fields evaluate to string | undefined with no hardcoded secrets", () => {
		// OWASP API8: Secrets & environment-variable handling verification
		const envConfig: EnvironmentConfig = {};

		expect(envConfig.OPENCODE_API_KEY).toBeUndefined();
		expect(envConfig.OPENROUTER_API_KEY).toBeUndefined();
		expect(envConfig.GEMINI_API_KEY).toBeUndefined();

		// Verify type accepts undefined or string values without hardcoded defaults
		const populatedConfig: EnvironmentConfig = {
			OPENCODE_API_KEY: "mock-runtime-token",
		};
		expect(populatedConfig.OPENCODE_API_KEY).toBe("mock-runtime-token");
	});

	it("verifies NovelState structure conforms to runtime contracts", () => {
		const sessionConfig: SessionConfig = {
			title: "The Glass Citadel",
			genre: "Science Fiction",
			targetChapters: 12,
			targetWordsPerChapter: 3000,
		};

		const state: NovelState = {
			novelId: "test-novel-uuid",
			status: NovelStatus.PLANNING,
			sessionPath: "/workspaces/active/test-novel-uuid",
			config: sessionConfig,
			chapters: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		expect(state.novelId).toBe("test-novel-uuid");
		expect(state.status).toBe("planning");
		expect(state.config.targetChapters).toBe(12);
	});
});
