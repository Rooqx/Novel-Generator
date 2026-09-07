import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from "@nestjs/common";

export interface HttpRequest {
	url?: string;
	method?: string;
	headers?: Record<string, string | string[] | undefined>;
}

export interface HttpResponse {
	status(code: number): HttpResponse;
	json(body: unknown): void;
}

export interface ErrorResponseBody {
	readonly statusCode: number;
	readonly timestamp: string;
	readonly path: string;
	readonly message: string | object;
	readonly error?: string;
	readonly correlationId?: string;
}

/**
 * Global exception filter enforcing OWASP API8 (Security Misconfiguration) by
 * sanitizing error responses, stripping internal traces in production, and emitting
 * structured JSON telemetry to standard error.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(GlobalExceptionFilter.name);

	catch(exception: unknown, host: ArgumentsHost): void {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<HttpResponse>();
		const request = ctx.getRequest<HttpRequest>();

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
			clientMessage = "Internal server error";
			errorName = "InternalServerError";
		} else {
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
