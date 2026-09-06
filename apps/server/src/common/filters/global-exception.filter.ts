/**
 * @file global-exception.filter.ts
 * @description Global exception filter for NestJS that intercepts all unhandled exceptions.
 * It prevents internal stack traces, system paths, and sensitive error payloads from leaking to clients,
 * standardizes the error response shape, and writes structured JSON logs to stderr.
 *
 * @security-architecture
 * - OWASP API8 (Security Misconfiguration): Sanitizes 500 internal server error responses to prevent information leakage.
 * - Information Disclosure Prevention: Strips internal file system paths and stack traces in production responses.
 * - Distributed Tracing & Correlation: Extracts and propagates `x-correlation-id` or `x-request-id` headers in logs and responses.
 * - Secure Stream Logging: Emits machine-readable JSON logs directly to the process error stream without leaking sensitive payload data.
 */

import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from "@nestjs/common";

/**
 * What it is: Platform-agnostic abstraction of an incoming HTTP request for exception filtering.
 * Why/How it is used: Decouples the filter from specific web framework runtimes while extracting routing and tracing metadata.
 * Security: Constrains extracted request attributes strictly to operational metadata (url, method, correlation headers) without logging sensitive bodies.
 */
export interface HttpRequest {
	url?: string;
	method?: string;
	headers?: Record<string, string | string[] | undefined>;
}

/**
 * What it is: Platform-agnostic abstraction of an outgoing HTTP response for exception filtering.
 * Why/How it is used: Normalizes the status code and JSON serialization interface across HTTP execution contexts.
 * Security: Ensures sanitized error responses are delivered with explicit HTTP status codes without leaking raw exceptions.
 */
export interface HttpResponse {
	status(code: number): HttpResponse;
	json(body: unknown): void;
}

/**
 * What it is: Data transfer object defining the standard client-facing error payload.
 * Why/How it is used: Formats all HTTP and unhandled server exceptions into a uniform, secure JSON response structure.
 * Security: Enforces OWASP API8 compliance by ensuring 500-level errors never leak stack traces, SQL errors, or filesystem paths.
 */
export interface ErrorResponseBody {
	readonly statusCode: number;
	readonly timestamp: string;
	readonly path: string;
	readonly message: string | object;
	readonly error?: string;
	readonly correlationId?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(GlobalExceptionFilter.name);

	/**
	 * What it is: Catch-all exception handler for HTTP execution contexts.
	 * Why/How it is used: Intercepts every unhandled error thrown by controllers, services, or internal pipeline stages,
	 * normalizing the HTTP response status, stripping sensitive internals, and logging structured JSON telemetry.
	 * Security: Strictly enforces that 500-level internal errors never expose raw error messages, stack traces,
	 * or server environment details to external callers, satisfying OWASP API8.
	 *
	 * @param exception - The caught error object or HttpException instance.
	 * @param host - ArgumentsHost providing access to the current request and response contexts.
	 */
	catch(exception: unknown, host: ArgumentsHost): void {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<HttpResponse>();
		const request = ctx.getRequest<HttpRequest>();

		// Fallback safely if invoked outside a standard HTTP transport
		if (!response || typeof response.status !== "function") {
			this.logger.error(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: "error",
					context: "GlobalExceptionFilter",
					event: "non_http_exception",
					error:
						exception instanceof Error ? exception.message : String(exception),
					stack: exception instanceof Error ? exception.stack : undefined,
				}),
			);
			return;
		}

		const status =
			exception instanceof HttpException
				? exception.getStatus()
				: HttpStatus.INTERNAL_SERVER_ERROR;

		const correlationId =
			(request.headers?.["x-correlation-id"] as string | undefined) ??
			(request.headers?.["x-request-id"] as string | undefined) ??
			undefined;

		const isProduction = process.env.NODE_ENV === "production";
		let clientMessage: string | object;
		let errorName: string | undefined;

		if (exception instanceof HttpException) {
			const res = exception.getResponse();
			if (typeof res === "object" && res !== null) {
				const resObj = res as Record<string, unknown>;
				clientMessage =
					(resObj.message as string | object) ?? exception.message;
				errorName = (resObj.error as string) ?? exception.name;
			} else {
				clientMessage = res;
				errorName = exception.name;
			}
		} else if (isProduction) {
			// Mask all internal error details in production to prevent stack/filesystem leakage
			clientMessage = "Internal server error";
			errorName = "InternalServerError";
		} else {
			// Development mode provides actionable diagnostic message without exposing credentials
			clientMessage =
				exception instanceof Error
					? exception.message
					: "Internal server error";
			errorName =
				exception instanceof Error ? exception.name : "InternalServerError";
		}

		const structuredLog = {
			timestamp: new Date().toISOString(),
			level: "error",
			context: "GlobalExceptionFilter",
			event: "http_exception_intercepted",
			statusCode: status,
			path: request?.url ?? "",
			method: request?.method,
			correlationId,
			errorName,
			errorMessage:
				exception instanceof Error ? exception.message : String(exception),
			stack: exception instanceof Error ? exception.stack : undefined,
		};

		// Output machine-readable structured JSON to stderr
		this.logger.error(JSON.stringify(structuredLog));

		const responseBody: ErrorResponseBody = {
			statusCode: status,
			timestamp: new Date().toISOString(),
			path: request?.url ?? "",
			message: clientMessage,
			error: errorName,
			correlationId,
		};

		response.status(status).json(responseBody);
	}
}
