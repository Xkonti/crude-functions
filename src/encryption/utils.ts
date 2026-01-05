/**
 * Converts a base64 string to Uint8Array
 * Uses native atob() for consistency with authorization_extractor.ts
 *
 * @param base64 - Base64-encoded string
 * @returns Decoded bytes
 * @throws Error if base64 string is invalid
 */
export function base64ToBytes(base64: string): Uint8Array {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    throw new Error(
      `Invalid base64 string: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Converts a Uint8Array to base64 string
 * Uses native btoa() for consistency
 *
 * @param bytes - Byte array to encode
 * @returns Base64-encoded string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const binaryString = String.fromCharCode(...bytes);
  return btoa(binaryString);
}
