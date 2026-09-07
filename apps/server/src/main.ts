import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";

async function bootstrap(): Promise<void> {
	const logger = new Logger("Bootstrap");
	const app = await NestFactory.create(AppModule);

	app.useGlobalFilters(new GlobalExceptionFilter());
	app.useGlobalInterceptors(new LoggingInterceptor());
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
