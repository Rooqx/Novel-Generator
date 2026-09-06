/**
 * @file global-exception.filter.spec.ts
 * @description Unit tests for GlobalExceptionFilter verifying OWASP API8 compliance,
 * production stack trace suppression, and distributed correlation propagation.
 *
 * @security-architecture
 * - Tests that production 500 error responses strip stack traces and internal messages.
 * - Tests that correlation IDs are preserved and mapped into structured payloads.
 * - Tests that standard HttpExceptions maintain expected status codes and client messages.
 */

import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException, HttpStatus } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ErrorResponseBody,
	GlobalExceptionFilter,
	type HttpRequest,
	type HttpResponse,
} from "./global-exception.filter";

describe("GlobalExceptionFilter", () => {
	let filter: GlobalExceptionFilter;
	let originalEnv: string | undefined;

	beforeEach(() => {
		filter = new GlobalExceptionFilter();
		originalEnv = process.env.NODE_ENV;
	});

	afterEach(() => {
		process.env.NODE_ENV = originalEnv;
		vi.restoreAllMocks();
	});

	function createMockHost(
		request: Partial<HttpRequest> = {},
		responseMock: HttpResponse,
	): ArgumentsHost {
		const req: HttpRequest = {
			url: "/api/test",
			method: "GET",
			headers: {},
			...request,
		};

		return {
			switchToHttp: () => ({
				getRequest: () => req,
				getResponse: () => responseMock,
			}),
		} as unknown as ArgumentsHost;
	}

	it("sanitizes 500 internal server errors in production to prevent stack trace leaks (OWASP API8)", () => {
		process.env.NODE_ENV = "production";

		let capturedStatus = 0;
		let capturedBody: ErrorResponseBody | undefined;

		const responseMock: HttpResponse = {
			status: vi.fn().mockImplementation((s: number) => {
				capturedStatus = s;
				return responseMock;
			}),
			json: vi.fn().mockImplementation((b: unknown) => {
				capturedBody = b as ErrorResponseBody;
			}),
		};

		const host = createMockHost(
			{
				url: "/api/novels",
				method: "POST",
				headers: { "x-correlation-id": "test-corr-123" },
			},
			responseMock,
		);

		const sensitiveInternalError = new Error(
			"DATABASE CONNECTION FAILED: password123 at /var/app/internal.js:42",
		);

		filter.catch(sensitiveInternalError, host);

		expect(capturedStatus).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
		expect(capturedBody).toBeDefined();
		const body = capturedBody as ErrorResponseBody;
		expect(body.message).toBe("Internal server error");
		expect(body.error).toBe("InternalServerError");
		expect(body.correlationId).toBe("test-corr-123");
		expect(body.path).toBe("/api/novels");

		// Crucial OWASP check: ensure NO stack trace or internal text leaks
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain("password123");
		expect(serialized).not.toContain("/var/app/internal.js");
		expect(serialized).not.toContain("stack");
	});

	it("preserves HttpException status and payload details for safe 4xx client errors", () => {
		let capturedStatus = 0;
		let capturedBody: ErrorResponseBody | undefined;

		const responseMock: HttpResponse = {
			status: vi.fn().mockImplementation((s: number) => {
				capturedStatus = s;
				return responseMock;
			}),
			json: vi.fn().mockImplementation((b: unknown) => {
				capturedBody = b as ErrorResponseBody;
			}),
		};

		const host = createMockHost(
			{
				url: "/api/novels/invalid-id",
				method: "GET",
				headers: { "x-request-id": "req-xyz-789" },
			},
			responseMock,
		);

		const badRequest = new BadRequestException("Invalid novel identifier");

		filter.catch(badRequest, host);

		expect(capturedStatus).toBe(HttpStatus.BAD_REQUEST);
		expect(capturedBody).toBeDefined();
		const body = capturedBody as ErrorResponseBody;
		expect(body.message).toBe("Invalid novel identifier");
		expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
		expect(body.correlationId).toBe("req-xyz-789");
	});
});
