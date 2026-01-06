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
  // Use chunked approach to avoid stack overflow with large arrays
  // String.fromCharCode(...bytes) fails for arrays > ~65KB due to argument limit
  let binaryString = "";
  const chunkSize = 8192; // Process 8KB at a time
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binaryString += String.fromCharCode(...chunk);
  }
  return btoa(binaryString);
}
