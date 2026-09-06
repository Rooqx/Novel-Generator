import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Dockerfile Auth Manifest Specification", () => {
	const dockerfilePath = resolve(__dirname, "../Dockerfile");
	const dockerfileContent = readFileSync(dockerfilePath, "utf-8");

	it("contains directive to create opencode configuration directory", () => {
		expect(dockerfileContent).toMatch(
			/mkdir -p (?:~\/|\/root\/)\.local\/share\/opencode/,
		);
	});

	it("enforces strict Unix file permissions (0600) on auth.json", () => {
		// OWASP API8: Security Misconfiguration mitigation
		expect(dockerfileContent).toMatch(
			/chmod 0600 (?:~\/|\/root\/)\.local\/share\/opencode\/auth\.json/,
		);
	});

	it("extracts and validates static auth.json payload matching blueprint schema", () => {
		// Extract the JSON string passed to echo
		const jsonMatch = dockerfileContent.match(/echo '([\s\S]*?)' >/);
		expect(jsonMatch).not.toBeNull();

		if (!jsonMatch) {
			throw new Error("Failed to extract JSON payload from Dockerfile");
		}

		// Replaces escape sequences to reconstruct JSON object as written in container
		const rawJson = jsonMatch[1].replace(/\\n/g, "\n");
		const parsedManifest = JSON.parse(rawJson);

		expect(parsedManifest).toEqual({
			zen: { key: "env:OPENCODE_API_KEY" },
			openrouter: { key: "env:OPENROUTER_API_KEY" },
			google: { key: "env:GEMINI_API_KEY" },
		});
	});

	it("ensures no raw secrets or build arguments are embedded in Dockerfile", () => {
		// OWASP API8: Secrets & environment-variable handling verification
		expect(dockerfileContent).not.toMatch(/OPENCODE_API_KEY=\w+/);
		expect(dockerfileContent).not.toMatch(/OPENROUTER_API_KEY=\w+/);
		expect(dockerfileContent).not.toMatch(/GEMINI_API_KEY=\w+/);
		expect(dockerfileContent).not.toMatch(/ARG\s+.*KEY/i);
	});

	it("verifies manifest is declared in base stage before runner and builder", () => {
		// Guarantees configuration is present before application processes boot
		const baseStageIndex = dockerfileContent.indexOf(
			"FROM node:22-bookworm-slim AS base",
		);
		const manifestIndex = dockerfileContent.indexOf(
			".local/share/opencode/auth.json",
		);
		const runnerStageIndex = dockerfileContent.indexOf("FROM base AS runner");

		expect(baseStageIndex).toBeGreaterThan(-1);
		expect(manifestIndex).toBeGreaterThan(baseStageIndex);
		expect(manifestIndex).toBeLessThan(runnerStageIndex);
	});
});
