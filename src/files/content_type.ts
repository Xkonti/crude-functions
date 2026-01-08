/**
 * Content-type detection utility using extension-based lookup.
 * Provides common MIME types with custom overrides for code files.
 */

// Custom overrides for code/config files
const CUSTOM_MIME_TYPES: Record<string, string> = {
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".mts": "text/typescript",
  ".cts": "text/typescript",
  ".jsx": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".vue": "text/x-vue",
  ".svelte": "text/x-svelte",
  ".jsonc": "application/json",
  ".env": "text/plain",
  ".gitignore": "text/plain",
  ".dockerignore": "text/plain",
  ".editorconfig": "text/plain",
  ".prettierrc": "application/json",
  ".eslintrc": "application/json",
};

// Common MIME types for typical file extensions
const COMMON_MIME_TYPES: Record<string, string> = {
  // Text/Code
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/plain",
  ".csv": "text/csv",
  ".sql": "text/plain",
  ".sh": "text/x-shellscript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java",
  ".kt": "text/x-kotlin",
  ".swift": "text/x-swift",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c",
  ".hpp": "text/x-c++",
  ".php": "text/x-php",

  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".avif": "image/avif",

  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",

  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",

  // Archives
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",

  // Documents
  ".pdf": "application/pdf",

  // Fonts
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",

  // Binaries/Data
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".pt": "application/octet-stream",
  ".safetensors": "application/octet-stream",
};

/**
 * Extract file extension from filename (lowercase, includes dot).
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return "";
  }
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Get content type for a file based on its extension.
 * Returns "application/octet-stream" for unknown types.
 */
export function getContentType(filename: string): string {
  const ext = getExtension(filename);

  // Check custom overrides first
  if (ext in CUSTOM_MIME_TYPES) {
    return CUSTOM_MIME_TYPES[ext];
  }

  // Check common types
  if (ext in COMMON_MIME_TYPES) {
    return COMMON_MIME_TYPES[ext];
  }

  // Default to binary
  return "application/octet-stream";
}

/**
 * Check if a content type represents text (for JSON response encoding decisions).
 */
export function isTextContentType(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType === "application/javascript" ||
    contentType.endsWith("+json") ||
    contentType.endsWith("+xml")
  );
}
