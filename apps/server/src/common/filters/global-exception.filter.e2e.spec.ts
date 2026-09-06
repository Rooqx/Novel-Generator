/**
 * @file global-exception.filter.e2e.spec.ts
 * @description End-to-end integration test for GlobalExceptionFilter verifying OWASP API8 compliance,
 * ensuring no stack traces, database credentials, or server file paths leak over the HTTP network in production mode.
 *
 * @security-architecture
 * - OWASP API8 (Security Misconfiguration): E2E verification asserting that 500 internal server errors
 *   return sanitized payloads without stack traces or environment paths in production.
 * - HTTP Pipeline Integration: Exercises the complete NestJS HTTP pipeline including exception filters,
 *   header parsing, and JSON serialization over live TCP sockets.
 */

import type { INestApplication } from "@nestjs/common";
import { BadRequestException, Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type ErrorResponseBody,
	GlobalExceptionFilter,
} from "./global-exception.filter";

@Controller("test-errors")
class TestErrorController {
	@Get("unhandled-500")
	triggerUnhandledError(): never {
		throw new Error(
			"DATABASE CRASH: postgres://admin:super_secret_db_password_123@10.0.0.1:5432/prod at /var/app/internal/db.ts:42",
		);
	}

	@Get("bad-request-400")
	triggerBadRequest(): never {
		throw new BadRequestException("Invalid novel identifier format");
	}
}

@Module({
	controllers: [TestErrorController],
})
class TestErrorModule {}

describe("GlobalExceptionFilter (E2E Production Audit)", () => {
	let app: INestApplication;
	let baseUrl: string;
	let originalEnv: string | undefined;

	beforeAll(async () => {
		originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";

		app = await NestFactory.create(TestErrorModule, {
			logger: false, // Suppress console logs during test execution
		});

		app.useGlobalFilters(new GlobalExceptionFilter());

		// Bind to an ephemeral port for live TCP execution
		await app.listen(0);
		const server = app.getHttpServer();
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 3000;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		process.env.NODE_ENV = originalEnv;
		await app.close();
	});

	it("prevents stack traces and server credentials from leaking over HTTP on 500 errors (OWASP API8)", async () => {
		const correlationId = "e2e-trace-corr-777";
		const response = await fetch(`${baseUrl}/test-errors/unhandled-500`, {
			headers: {
				"x-correlation-id": correlationId,
			},
		});

		expect(response.status).toBe(500);

		const rawBodyText = await response.text();
		const body = JSON.parse(rawBodyText) as ErrorResponseBody;

		// Assert structured sanitized error response shape
		expect(body.statusCode).toBe(500);
		expect(body.message).toBe("Internal server error");
		expect(body.error).toBe("InternalServerError");
		expect(body.path).toBe("/test-errors/unhandled-500");
		expect(body.correlationId).toBe(correlationId);
		expect(typeof body.timestamp).toBe("string");

		// Crucial security assertions: sensitive details must NOT appear anywhere in the HTTP response
		expect(rawBodyText).not.toContain("super_secret_db_password_123");
		expect(rawBodyText).not.toContain("postgres://");
		expect(rawBodyText).not.toContain("/var/app/internal/db.ts");
		expect(rawBodyText).not.toContain("DATABASE CRASH");
		expect(rawBodyText).not.toContain("stack");
	});

	it("preserves safe HTTP exception payloads for 4xx client errors over HTTP", async () => {
		const requestId = "e2e-trace-req-888";
		const response = await fetch(`${baseUrl}/test-errors/bad-request-400`, {
			headers: {
				"x-request-id": requestId,
			},
		});

		expect(response.status).toBe(400);

		const body = (await response.json()) as ErrorResponseBody;
		expect(body.statusCode).toBe(400);
		expect(body.message).toBe("Invalid novel identifier format");
		expect(body.error).toBe("Bad Request");
		expect(body.correlationId).toBe(requestId);
		expect(body.path).toBe("/test-errors/bad-request-400");
	});
});
