/**
 * @file workspace.module.ts
 * @description NestJS feature module encapsulating the WorkspaceService provider.
 * Manages dependency injection and exposes workspace isolation capabilities to sibling modules.
 *
 * @security-architecture
 * - Encapsulation: Confines filesystem manipulation exclusively to WorkspaceService.
 * - Provider Export: Safely exports WorkspaceService for internal programmatic consumption across NestJS modules.
 */

import { Module } from "@nestjs/common";
import { WorkspaceService } from "./workspace.service";

/**
 * What it is: NestJS feature module for workspace management and session lifecycle.
 * Why/How it is used: Encapsulates WorkspaceService within the NestJS dependency injection tree and exports it for consumption by upstream modules.
 * Security: Establishes an encapsulation boundary ensuring filesystem cloning and path validation are accessed solely through WorkspaceService.
 */
@Module({
	providers: [WorkspaceService],
	exports: [WorkspaceService],
})
export class WorkspaceModule {}
