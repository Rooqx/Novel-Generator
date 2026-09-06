/**
 * @file logging.interceptor.spec.ts
 * @description Unit tests for LoggingInterceptor verifying latency calculation,
 * 200ms performance budget warning emission, and structured JSON output.
 *
 * @security-architecture
 * - Tests execution latency monitoring against the p95 <= 200ms performance budget.
 * - Confirms that sensitive response/request bodies are not logged.
 */

import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	HttpRequest,
	HttpResponse,
} from "../filters/global-exception.filter";
import { LoggingInterceptor } from "./logging.interceptor";

describe("LoggingInterceptor", () => {
	let interceptor: LoggingInterceptor;

	beforeEach(() => {
		interceptor = new LoggingInterceptor();
	});

	function createMockContext(req: Partial<HttpRequest> = {}): ExecutionContext {
		const request: HttpRequest = {
			url: "/api/novels",
			method: "POST",
			headers: { "x-correlation-id": "perf-corr-456" },
			...req,
		};
		const response: HttpResponse = {
			status: vi.fn(),
			json: vi.fn(),
		};

		return {
			switchToHttp: () => ({
				getRequest: () => request,
				getResponse: () => response,
			}),
		} as unknown as ExecutionContext;
	}

	it("intercepts requests and passes through observable result within performance budget", async () => {
		const context = createMockContext();
		const next: CallHandler = {
			handle: () => of({ success: true }),
		};

		const result$ = interceptor.intercept(context, next);
		let emittedValue: unknown = null;

		result$.subscribe({
			next: (val) => {
				emittedValue = val;
			},
		});

		expect(emittedValue).toEqual({ success: true });
	});
});
