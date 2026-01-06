import {
  resolveAndValidatePath,
} from "../validation/files.ts";

export interface FileMetadata {
  path: string;
  size: number;
  mtime: Date;
}

export interface FileServiceOptions {
  basePath: string;
}

export class FileService {
  private basePath: string;

  constructor(options: FileServiceOptions) {
    this.basePath = options.basePath;
  }

  /**
   * Resolves a relative path to an absolute path within the base directory.
   * Uses secure path validation to prevent traversal attacks.
   */
  private async resolvePath(relativePath: string): Promise<string> {
    return await resolveAndValidatePath(this.basePath, relativePath);
  }

  /**
   * Lists all files in the base directory recursively.
   * Returns a sorted flat list of relative paths.
   */
  async listFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.scanDirectory(this.basePath, "", files);
    return files.sort();
  }

  /**
   * Lists all files in the base directory recursively with metadata.
   * Returns a list sorted by path, including size and modification time.
   */
  async listFilesWithMetadata(): Promise<FileMetadata[]> {
    const files: FileMetadata[] = [];
    await this.scanDirectoryWithMetadata(this.basePath, "", files);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async scanDirectoryWithMetadata(
    absolutePath: string,
    relativePath: string,
    files: FileMetadata[]
  ): Promise<void> {
    try {
      for await (const entry of Deno.readDir(absolutePath)) {
        const entryRelPath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;
        const entryAbsPath = `${absolutePath}/${entry.name}`;

        if (entry.isFile) {
          const stat = await Deno.stat(entryAbsPath);
          files.push({
            path: entryRelPath,
            size: stat.size,
            mtime: stat.mtime ?? new Date(0),
          });
        } else if (entry.isDirectory) {
          await this.scanDirectoryWithMetadata(entryAbsPath, entryRelPath, files);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }
      throw error;
    }
  }

  private async scanDirectory(
    absolutePath: string,
    relativePath: string,
    files: string[]
  ): Promise<void> {
    try {
      for await (const entry of Deno.readDir(absolutePath)) {
        const entryRelPath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;
        const entryAbsPath = `${absolutePath}/${entry.name}`;

        if (entry.isFile) {
          files.push(entryRelPath);
        } else if (entry.isDirectory) {
          await this.scanDirectory(entryAbsPath, entryRelPath, files);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }
      throw error;
    }
  }

  /**
   * Gets the content of a file by its relative path.
   * Returns null if the file doesn't exist.
   */
  async getFile(path: string): Promise<string | null> {
    const absPath = await this.resolvePath(path);
    try {
      return await Deno.readTextFile(absPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Checks if a file exists at the given relative path.
   */
  async fileExists(path: string): Promise<boolean> {
    const absPath = await this.resolvePath(path);
    try {
      const stat = await Deno.stat(absPath);
      return stat.isFile;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Writes content to a file at the given relative path.
   * Creates parent directories if they don't exist.
   * Returns true if the file was created, false if it was updated.
   */
  async writeFile(path: string, content: string): Promise<boolean> {
    const absPath = await this.resolvePath(path);
    const exists = await this.fileExists(path);

    // Ensure parent directories exist
    const lastSlash = absPath.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentDir = absPath.substring(0, lastSlash);
      await Deno.mkdir(parentDir, { recursive: true });
    }

    await Deno.writeTextFile(absPath, content);
    return !exists;
  }

  /**
   * Deletes a file at the given relative path.
   */
  async deleteFile(path: string): Promise<void> {
    const absPath = await this.resolvePath(path);
    await Deno.remove(absPath);
  }
}
