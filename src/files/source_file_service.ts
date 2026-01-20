import { join } from "@std/path";
import { FileService, type FileMetadata } from "./file_service.ts";
import type { CodeSourceService } from "../sources/code_source_service.ts";
import {
  SourceNotFoundError,
  SourceNotEditableError,
} from "../sources/errors.ts";

export interface SourceFileServiceOptions {
  codeSourceService: CodeSourceService;
  codeDirectory: string;
}

/**
 * Source-aware file service.
 *
 * Wraps FileService with source validation, ensuring:
 * - Read operations: source must exist
 * - Write operations: source must exist AND be editable
 *
 * Each source maps to a subdirectory under codeDirectory.
 */
export class SourceFileService {
  private readonly codeSourceService: CodeSourceService;
  private readonly codeDirectory: string;
  private readonly fileServiceCache = new Map<string, FileService>();

  constructor(options: SourceFileServiceOptions) {
    this.codeSourceService = options.codeSourceService;
    this.codeDirectory = options.codeDirectory;
  }

  /**
   * Get or create a FileService for a specific source.
   */
  private getFileService(sourceName: string): FileService {
    let fileService = this.fileServiceCache.get(sourceName);
    if (!fileService) {
      fileService = new FileService({
        basePath: join(this.codeDirectory, sourceName),
      });
      this.fileServiceCache.set(sourceName, fileService);
    }
    return fileService;
  }

  /**
   * Validate that a source exists.
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  private async validateSourceExists(sourceName: string): Promise<void> {
    const source = await this.codeSourceService.getByName(sourceName);
    if (!source) {
      throw new SourceNotFoundError(sourceName);
    }
  }

  /**
   * Validate that a source exists and is editable.
   * @throws {SourceNotFoundError} If source doesn't exist
   * @throws {SourceNotEditableError} If source is not editable
   */
  private async validateEditableSource(sourceName: string): Promise<void> {
    const source = await this.codeSourceService.getByName(sourceName);
    if (!source) {
      throw new SourceNotFoundError(sourceName);
    }

    const isEditable = await this.codeSourceService.isEditable(source.id);
    if (!isEditable) {
      throw new SourceNotEditableError(sourceName, source.type);
    }
  }

  // ============== Read Operations ==============

  /**
   * Lists all files in the source directory recursively.
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  async listFiles(sourceName: string): Promise<string[]> {
    await this.validateSourceExists(sourceName);
    const fileService = this.getFileService(sourceName);
    return fileService.listFiles();
  }

  /**
   * Lists all files in the source directory with metadata.
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  async listFilesWithMetadata(sourceName: string): Promise<FileMetadata[]> {
    await this.validateSourceExists(sourceName);
    const fileService = this.getFileService(sourceName);
    return fileService.listFilesWithMetadata();
  }

  /**
   * Gets the content of a file as text.
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  async getFile(sourceName: string, path: string): Promise<string | null> {
    await this.validateSourceExists(sourceName);
    const fileService = this.getFileService(sourceName);
    return fileService.getFile(path);
  }

  /**
   * Gets the content of a file as bytes.
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  async getFileBytes(
    sourceName: string,
    path: string
  ): Promise<Uint8Array | null> {
    await this.validateSourceExists(sourceName);
    const fileService = this.getFileService(sourceName);
    return fileService.getFileBytes(path);
  }

  /**
   * Checks if a file exists.
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  async fileExists(sourceName: string, path: string): Promise<boolean> {
    await this.validateSourceExists(sourceName);
    const fileService = this.getFileService(sourceName);
    return fileService.fileExists(path);
  }

  // ============== Write Operations (require editable source) ==============

  /**
   * Writes text content to a file.
   * @throws {SourceNotFoundError} If source doesn't exist
   * @throws {SourceNotEditableError} If source is not editable
   * @returns true if file was created, false if updated
   */
  async writeFile(
    sourceName: string,
    path: string,
    content: string
  ): Promise<boolean> {
    await this.validateEditableSource(sourceName);
    const fileService = this.getFileService(sourceName);
    return fileService.writeFile(path, content);
  }

  /**
   * Writes binary content to a file.
   * @throws {SourceNotFoundError} If source doesn't exist
   * @throws {SourceNotEditableError} If source is not editable
   * @returns true if file was created, false if updated
   */
  async writeFileBytes(
    sourceName: string,
    path: string,
    content: Uint8Array
  ): Promise<boolean> {
    await this.validateEditableSource(sourceName);
    const fileService = this.getFileService(sourceName);
    return fileService.writeFileBytes(path, content);
  }

  /**
   * Deletes a file.
   * @throws {SourceNotFoundError} If source doesn't exist
   * @throws {SourceNotEditableError} If source is not editable
   */
  async deleteFile(sourceName: string, path: string): Promise<void> {
    await this.validateEditableSource(sourceName);
    const fileService = this.getFileService(sourceName);
    return fileService.deleteFile(path);
  }
}
