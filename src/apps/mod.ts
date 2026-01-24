/**
 * App modules for the two-port architecture.
 *
 * Crude Functions runs two separate HTTP servers:
 * - Function app (FUNCTION_PORT, default 8000): Executes deployed functions
 * - Management app (MANAGEMENT_PORT, default 9000): API, Auth, and Web UI
 */

export { createFunctionApp } from "./function_app.ts";
export { createManagementApp, type ManagementAppDeps } from "./management_app.ts";
