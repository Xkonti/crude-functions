/**
 * Service dependency graph for TestSetupBuilder.
 *
 * This module defines the dependencies between services to enable
 * auto-resolution when a service is requested. When a service flag
 * is set to true, all its dependencies are also enabled.
 */

/**
 * All available service keys that can be selectively included.
 * Note: SurrealDB is not a toggleable service - it's always included
 * as part of the base test infrastructure.
 */
export type ServiceKey =
  | "executionMetricsService"
  | "metricsStateService"
  | "functionsService"
  | "fileService"
  | "encryptionService"
  | "hashService"
  | "settingsService"
  | "consoleLogService"
  | "apiKeyService"
  | "secretsService"
  | "auth"
  | "userService"
  | "instanceIdService"
  | "jobQueueService"
  | "schedulingService"
  | "codeSourceService";

/**
 * Service flags interface - tracks which services to include.
 * All flags default to false. When a flag is true, the service
 * will be initialized during build().
 * Note: SurrealDB is not a flag - it's always included as base infrastructure.
 */
export interface ServiceFlags {
  executionMetricsService: boolean;
  metricsStateService: boolean;
  functionsService: boolean;
  fileService: boolean;
  encryptionService: boolean;
  hashService: boolean;
  settingsService: boolean;
  consoleLogService: boolean;
  apiKeyService: boolean;
  secretsService: boolean;
  auth: boolean;
  userService: boolean;
  instanceIdService: boolean;
  jobQueueService: boolean;
  schedulingService: boolean;
  codeSourceService: boolean;
}

/**
 * Creates a new ServiceFlags object with all flags set to false.
 */
export function createDefaultFlags(): ServiceFlags {
  return {
    executionMetricsService: false,
    metricsStateService: false,
    functionsService: false,
    fileService: false,
    encryptionService: false,
    hashService: false,
    settingsService: false,
    consoleLogService: false,
    apiKeyService: false,
    secretsService: false,
    auth: false,
    userService: false,
    instanceIdService: false,
    jobQueueService: false,
    schedulingService: false,
    codeSourceService: false,
  };
}

/**
 * Service dependencies map.
 *
 * Each service key maps to an array of services it depends on.
 * When a service is enabled, all its dependencies are automatically enabled.
 *
 * Dependency chain examples:
 * - consoleLogService -> settingsService -> encryptionService, hashService
 * - apiKeyService -> encryptionService, hashService
 * - userService -> auth -> encryptionService
 */
export const DEPENDENCIES: Record<ServiceKey, ServiceKey[]> = {
  // Standalone services (no dependencies)
  executionMetricsService: [],
  metricsStateService: [],
  functionsService: [],
  fileService: [],
  instanceIdService: [],

  // Encryption layer (encryptionService includes hashService)
  encryptionService: ["hashService"],
  hashService: [],

  // Settings depends on encryption
  settingsService: ["encryptionService", "hashService"],

  // Console log depends on settings (which depends on encryption)
  consoleLogService: ["settingsService"],

  // API keys depend on encryption
  apiKeyService: ["encryptionService", "hashService"],

  // Secrets depend on encryption
  secretsService: ["encryptionService"],

  // Auth depends on encryption (for better_auth_secret)
  auth: ["encryptionService"],

  // User service depends on auth
  userService: ["auth"],

  // Job queue depends on instance ID service
  jobQueueService: ["instanceIdService"],

  // Scheduling depends on job queue service
  schedulingService: ["jobQueueService"],

  // Code source service depends on scheduling, job queue, and encryption
  codeSourceService: ["schedulingService", "encryptionService"],
};

/**
 * Resolves all dependencies for a given set of service keys.
 * Returns the complete set including all transitive dependencies.
 *
 * @param services - The initially requested services
 * @returns All services including dependencies
 */
export function resolveWithDependencies(services: ServiceKey[]): Set<ServiceKey> {
  const resolved = new Set<ServiceKey>();
  const stack = [...services];

  while (stack.length > 0) {
    const service = stack.pop()!;
    if (resolved.has(service)) continue;

    resolved.add(service);
    stack.push(...DEPENDENCIES[service]);
  }

  return resolved;
}

/**
 * Enables a service and all its dependencies in the flags object.
 * Mutates the flags object in place.
 *
 * @param flags - The flags object to mutate
 * @param service - The service to enable
 */
export function enableServiceWithDependencies(
  flags: ServiceFlags,
  service: ServiceKey
): void {
  const allServices = resolveWithDependencies([service]);
  for (const s of allServices) {
    flags[s] = true;
  }
}

/**
 * Gets all enabled services from a flags object.
 *
 * @param flags - The flags object to check
 * @returns Array of enabled service keys
 */
export function getEnabledServices(flags: ServiceFlags): ServiceKey[] {
  return (Object.entries(flags) as [ServiceKey, boolean][])
    .filter(([_, enabled]) => enabled)
    .map(([key]) => key);
}

/**
 * Checks if any service flags are enabled.
 *
 * @param flags - The flags object to check
 * @returns true if at least one service is enabled
 */
export function hasAnyServiceEnabled(flags: ServiceFlags): boolean {
  return Object.values(flags).some(Boolean);
}

/**
 * Enables all services in the flags object.
 * Mutates the flags object in place.
 *
 * @param flags - The flags object to mutate
 */
export function enableAllServices(flags: ServiceFlags): void {
  for (const key of Object.keys(flags) as ServiceKey[]) {
    flags[key] = true;
  }
}
