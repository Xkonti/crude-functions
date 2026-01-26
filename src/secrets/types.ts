/**
 * Types for secrets management system
 */

/**
 * Complete secret record with all fields
 * Values are decrypted when loaded from database
 */
export interface Secret {
  id: number;
  name: string;
  value: string; // Decrypted value (empty string if decryption failed)
  decryptionError?: string; // Set if decryption failed
  comment: string | null;
  scope: number; // 0=global, 1=function, 2=group, 3=key
  functionId: number | null;
  apiGroupId: number | null;
  apiKeyId: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Secret row for list view (without value field)
 * Used when listing secrets to avoid decrypting all values
 */
export interface SecretRow {
  id: number;
  name: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown; // Index signature for Row compatibility
}

/**
 * Secret scope enum
 */
export enum SecretScope {
  Global = 0,
  Function = 1,
  Group = 2,
  Key = 3,
}

/**
 * Preview source for secrets preview feature
 */
export interface SecretPreviewSource {
  scope: 'global' | 'function' | 'group' | 'key';
  value: string;
  decryptionError?: string; // Set if decryption failed
  groupId?: string;
  groupName?: string;
  keyId?: string;
  keyName?: string;
}

/**
 * Secret preview data structure
 */
export interface SecretPreview {
  name: string;
  sources: SecretPreviewSource[];
}
