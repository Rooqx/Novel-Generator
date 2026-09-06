/**
 * @file main.ts
 * @description Application bootstrap script for the NestJS server. Initializes the root
 * AppModule, binds global exception filters for security misconfiguration protection,
 * and starts listening for HTTP and internal service requests.
 *
 * @security-architecture
 * - Global Exception Sanitization: Registers GlobalExceptionFilter to ensure no raw stack traces
 *   or sensitive internal details leak across HTTP endpoints (OWASP API8).
 * - Graceful Shutdown: Hooks system termination signals (SIGTERM/SIGINT) to allow in-flight transactions
 *   and filesystem operations to finish safely.
 * - Environment Binding: Reads port and configuration dynamically from process environment without hardcoding.
 */

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";

/**
 * What it is: Primary bootstrap function for the NestJS orchestration backend.
 * Why/How it is used: Instantiates the NestJS application container, mounts cross-cutting filters,
 * enables shutdown hooks, and binds the HTTP server to the designated port.
 * Security: Enforces global exception sanitization to shield system internals and manages controlled shutdown.
 */
async function bootstrap(): Promise<void> {
	const logger = new Logger("Bootstrap");
	const app = await NestFactory.create(AppModule);

	// Register global exception filter to intercept errors and prevent trace leaks (OWASP API8)
	app.useGlobalFilters(new GlobalExceptionFilter());

	// Register global logging interceptor for latency monitoring against p95 <= 200ms budget
	app.useGlobalInterceptors(new LoggingInterceptor());

	// Enable lifecycle shutdown hooks for graceful termination in container environments
	app.enableShutdownHooks();

	const port = Number.parseInt(process.env.PORT ?? "3000", 10);
	await app.listen(port);

	logger.log(
		JSON.stringify({
			timestamp: new Date().toISOString(),
			level: "info",
			context: "Bootstrap",
			event: "server_started",
			port,
			environment: process.env.NODE_ENV ?? "development",
		}),
	);
}

void bootstrap();
