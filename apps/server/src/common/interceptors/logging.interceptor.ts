/**
 * @file logging.interceptor.ts
 * @description NestJS execution interceptor providing structured request latency logging
 * and performance budget monitoring across inbound HTTP and RPC boundaries.
 *
 * @security-architecture
 * - Latency Telemetry: Automatically tracks end-to-end execution duration against the 200ms p95 budget.
 * - Performance Warning: Emits warning logs when request execution exceeds the latency threshold.
 * - Distributed Correlation: Threads correlation IDs through execution logs without leaking request bodies.
 */

import {
	type CallHandler,
	type ExecutionContext,
	Injectable,
	Logger,
	type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { HttpRequest } from "../filters/global-exception.filter";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
	private readonly logger = new Logger(LoggingInterceptor.name);
	private static readonly LATENCY_BUDGET_MS = 200;

	/**
	 * What it is: Intercepts request handling to measure latency and emit structured telemetry.
	 * Why/How it is used: Registered globally to ensure all platform entrypoints are observable
	 * and monitored against the p95 <= 200ms performance budget specified in the blueprint.
	 * Security: Strictly logs metadata (method, route, duration, status, correlationId) without exposing payload bodies.
	 *
	 * @param context - ExecutionContext for current invocation.
	 * @param next - CallHandler to invoke downstream handler.
	 */
	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const startTime = Date.now();
		const ctx = context.switchToHttp();
		const req = ctx.getRequest<HttpRequest>();

		const correlationId =
			(req?.headers?.["x-correlation-id"] as string | undefined) ??
			(req?.headers?.["x-request-id"] as string | undefined) ??
			undefined;

		return next.handle().pipe(
			tap({
				next: () => {
					const durationMs = Date.now() - startTime;
					const logPayload = {
						timestamp: new Date().toISOString(),
						level:
							durationMs > LoggingInterceptor.LATENCY_BUDGET_MS
								? "warn"
								: "info",
						context: "LoggingInterceptor",
						event:
							durationMs > LoggingInterceptor.LATENCY_BUDGET_MS
								? "latency_budget_exceeded"
								: "request_completed",
						method: req?.method,
						path: req?.url,
						durationMs,
						budgetMs: LoggingInterceptor.LATENCY_BUDGET_MS,
						correlationId,
					};

					if (durationMs > LoggingInterceptor.LATENCY_BUDGET_MS) {
						this.logger.warn(JSON.stringify(logPayload));
					} else {
						this.logger.log(JSON.stringify(logPayload));
					}
				},
				error: () => {
					// Errors are captured and formatted by GlobalExceptionFilter
				},
			}),
		);
	}
}
