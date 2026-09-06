/**
 * @file app.module.ts
 * @description Root application module for the NestJS server. Registers core feature modules
 * and foundational providers required for platform execution.
 *
 * @security-architecture
 * - Modular Scoping: Integrates the WorkspaceModule while strictly maintaining encapsulation
 *   and boundary separation across application layers.
 */

import { Module } from "@nestjs/common";
import { WorkspaceModule } from "./modules/workspace/workspace.module";

/**
 * What it is: Root application module for the NestJS backend orchestration server.
 * Why/How it is used: Bootstraps the dependency injection tree and wires together application feature modules.
 * Security: Serves as the top-level architectural gateway, ensuring feature modules remain isolated and bounded.
 */
@Module({
	imports: [WorkspaceModule],
	controllers: [],
	providers: [],
})
export class AppModule {}
