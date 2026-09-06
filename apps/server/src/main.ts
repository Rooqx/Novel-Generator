import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/**
 * Bootstraps the NestJS server runtime.
 */
async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
	await app.listen(port);
}

if (process.env.NODE_ENV !== "test") {
	bootstrap();
}
