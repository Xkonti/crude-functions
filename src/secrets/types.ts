/**
 * Types for secrets management system
 *
 * ID Handling Pattern:
 * - Runtime/Interfaces: Always use RecordId type
 * - API/Web UI boundaries: Convert to string via recordIdToString()
 */

import type { RecordId } from "surrealdb";

/**
 * Secret scope type - determines what the secret is scoped to
 */
export type SecretScopeType = "global" | "function" | "group" | "key";

/**
 * Complete secret record with all fields.
 * Values are decrypted when loaded from database.
 * IDs are RecordId - convert to string only at API/Web UI boundaries.
 */
export interface Secret {
  id: RecordId;
  name: string;
  value: string; // Decrypted value (empty string if decryption failed)
  decryptionError?: string; // Set if decryption failed
  comment?: string; // Optional - NONE in SurrealDB
  scopeType: SecretScopeType;
  scopeRef?: RecordId; // Optional - NONE for global scope (undefined in JS)
  createdAt: string;
  updatedAt: string;
}

/**
 * Raw row from SurrealDB query.
 * Contains encrypted value before decryption.
 */
export interface SecretRow {
  id: RecordId;
  name: string;
  value: string; // encrypted value
  comment?: string; // Optional - NONE in SurrealDB
  scopeType: SecretScopeType;
  scopeRef?: RecordId; // Optional - NONE for global scope (undefined in JS)
  createdAt: string;
  updatedAt: string;
}

/**
 * Secret scope enum - kept for backward compatibility during transition
 * @deprecated Use SecretScopeType string literals instead
 */
export enum SecretScope {
  Global = 0,
  Function = 1,
  Group = 2,
  Key = 3,
}

/**
 * Preview source for secrets preview feature.
 * Uses strings since it's for presentation layer.
 */
export interface SecretPreviewSource {
  scope: SecretScopeType;
  value: string;
  decryptionError?: string; // Set if decryption failed
  groupId?: string; // String for presentation
  groupName?: string;
  keyId?: string; // String for presentation
  keyName?: string;
}

/**
 * Secret preview data structure
 */
export interface SecretPreview {
  name: string;
  sources: SecretPreviewSource[];
}
