import {
	type CallHandler,
	type ExecutionContext,
	Logger,
} from "@nestjs/common";
import { of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoggingInterceptor } from "./logging.interceptor";

describe("LoggingInterceptor", () => {
	let interceptor: LoggingInterceptor;

	beforeEach(() => {
		interceptor = new LoggingInterceptor();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("intercepts and logs structured JSON telemetry for requests", async () => {
		const logSpy = vi.spyOn(Logger.prototype, "log");
		const mockContext = {
			switchToHttp: () => ({
				getRequest: () => ({
					method: "POST",
					url: "/api/novels",
					headers: { "x-correlation-id": "corr-interceptor-1" },
				}),
			}),
		} as unknown as ExecutionContext;

		const mockCallHandler: CallHandler = {
			handle: () => of({ success: true }),
		};

		const stream$ = interceptor.intercept(mockContext, mockCallHandler);

		await new Promise<void>((resolve, reject) => {
			stream$.subscribe({
				next: () => resolve(),
				error: (err) => reject(err),
			});
		});

		expect(logSpy).toHaveBeenCalled();
		const lastCall = logSpy.mock.calls[
			logSpy.mock.calls.length - 1
		][0] as string;
		const parsed = JSON.parse(lastCall);
		expect(parsed.event).toBe("request_completed");
		expect(parsed.correlationId).toBe("corr-interceptor-1");
		expect(parsed.method).toBe("POST");
		expect(parsed.path).toBe("/api/novels");
	});
});
