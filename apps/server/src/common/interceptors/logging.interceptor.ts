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

/**
 * Execution interceptor providing structured request latency telemetry
 * and monitoring execution duration against the blueprint's p95 <= 200ms budget.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
	private readonly logger = new Logger(LoggingInterceptor.name);
	private static readonly LATENCY_BUDGET_MS = 200;

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
					// Downstream errors are captured and formatted by GlobalExceptionFilter
				},
			}),
		);
	}
}
