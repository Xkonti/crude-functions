export interface FileSignature {
  path: string;
  size: number;
  mtime: number;
}

export interface CheckResult {
  changed: boolean;
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface FileWatcherOptions {
  path: string;
  refreshInterval?: number;
}

export class FileWatcher {
  private readonly targetPath: string;
  private readonly refreshInterval: number;
  private lastCheckTime = 0;
  private cache = new Map<string, FileSignature>();

  constructor(options: FileWatcherOptions) {
    this.targetPath = options.path;
    this.refreshInterval = options.refreshInterval ?? 10000;
  }

  async check(): Promise<CheckResult> {
    const now = Date.now();
    if (now - this.lastCheckTime < this.refreshInterval) {
      return { changed: false, added: [], modified: [], deleted: [] };
    }
    return await this.forceCheck();
  }

  async forceCheck(): Promise<CheckResult> {
    this.lastCheckTime = Date.now();
    const current = await this.scan();
    const result = this.diff(current);
    this.cache = current;
    return result;
  }

  getFiles(): Map<string, FileSignature> {
    return new Map(this.cache);
  }

  private async scan(): Promise<Map<string, FileSignature>> {
    const files = new Map<string, FileSignature>();
    const stat = await Deno.stat(this.targetPath);

    if (stat.isFile) {
      files.set(this.targetPath, {
        path: this.targetPath,
        size: stat.size,
        mtime: stat.mtime?.getTime() ?? 0,
      });
    } else if (stat.isDirectory) {
      await this.scanDirectory(this.targetPath, files);
    }

    return files;
  }

  private async scanDirectory(
    dirPath: string,
    files: Map<string, FileSignature>,
  ): Promise<void> {
    for await (const entry of Deno.readDir(dirPath)) {
      const fullPath = `${dirPath}/${entry.name}`;
      const stat = await Deno.stat(fullPath);

      if (stat.isFile) {
        files.set(fullPath, {
          path: fullPath,
          size: stat.size,
          mtime: stat.mtime?.getTime() ?? 0,
        });
      } else if (stat.isDirectory) {
        await this.scanDirectory(fullPath, files);
      }
    }
  }

  private diff(current: Map<string, FileSignature>): CheckResult {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    // Find added and modified
    for (const [path, sig] of current) {
      const cached = this.cache.get(path);
      if (!cached) {
        added.push(path);
      } else if (cached.size !== sig.size || cached.mtime !== sig.mtime) {
        modified.push(path);
      }
    }

    // Find deleted
    for (const path of this.cache.keys()) {
      if (!current.has(path)) {
        deleted.push(path);
      }
    }

    const changed = added.length > 0 || modified.length > 0 || deleted.length > 0;
    return { changed, added, modified, deleted };
  }
}
