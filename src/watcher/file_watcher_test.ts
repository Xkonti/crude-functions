import { expect } from "@std/expect";
import { FileWatcher } from "./file_watcher.ts";

Deno.test("FileWatcher can be constructed with a path", () => {
  const watcher = new FileWatcher({ path: "/tmp/test" });
  expect(watcher).toBeInstanceOf(FileWatcher);
});

Deno.test("check() returns added file on first check for single file", async () => {
  const tempFile = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(tempFile, "hello");

    const watcher = new FileWatcher({ path: tempFile });
    const result = await watcher.check();

    expect(result.changed).toBe(true);
    expect(result.added).toContain(tempFile);
    expect(result.modified).toEqual([]);
    expect(result.deleted).toEqual([]);
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("check() returns all files in directory and subdirectories", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Create files in root and subdirectory
    await Deno.writeTextFile(`${tempDir}/file1.txt`, "content1");
    await Deno.mkdir(`${tempDir}/subdir`);
    await Deno.writeTextFile(`${tempDir}/subdir/file2.txt`, "content2");

    const watcher = new FileWatcher({ path: tempDir });
    const result = await watcher.check();

    expect(result.changed).toBe(true);
    expect(result.added.length).toBe(2);
    expect(result.added).toContain(`${tempDir}/file1.txt`);
    expect(result.added).toContain(`${tempDir}/subdir/file2.txt`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("check() returns no changes when called within refresh interval", async () => {
  const tempFile = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(tempFile, "hello");

    // Use a short refresh interval for testing
    const watcher = new FileWatcher({ path: tempFile, refreshInterval: 100 });

    // First check should show file as added
    const result1 = await watcher.check();
    expect(result1.changed).toBe(true);

    // Modify file
    await Deno.writeTextFile(tempFile, "modified");

    // Second check immediately should return no changes (rate limited)
    const result2 = await watcher.check();
    expect(result2.changed).toBe(false);
    expect(result2.added).toEqual([]);
    expect(result2.modified).toEqual([]);
    expect(result2.deleted).toEqual([]);
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("check() detects modified files after refresh interval", async () => {
  const tempFile = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(tempFile, "hello");

    const watcher = new FileWatcher({ path: tempFile, refreshInterval: 50 });

    // First check
    await watcher.check();

    // Wait for refresh interval
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Modify file
    await Deno.writeTextFile(tempFile, "modified content");

    // Check should detect modification
    const result = await watcher.check();
    expect(result.changed).toBe(true);
    expect(result.modified).toContain(tempFile);
    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("check() detects deleted files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/file1.txt`, "content1");
    await Deno.writeTextFile(`${tempDir}/file2.txt`, "content2");

    const watcher = new FileWatcher({ path: tempDir, refreshInterval: 50 });

    // First check
    await watcher.check();

    // Wait for refresh interval
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Delete one file
    await Deno.remove(`${tempDir}/file2.txt`);

    // Check should detect deletion
    const result = await watcher.check();
    expect(result.changed).toBe(true);
    expect(result.deleted).toContain(`${tempDir}/file2.txt`);
    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("check() detects added files in directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/file1.txt`, "content1");

    const watcher = new FileWatcher({ path: tempDir, refreshInterval: 50 });

    // First check
    await watcher.check();

    // Wait for refresh interval
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Add new file
    await Deno.writeTextFile(`${tempDir}/file2.txt`, "content2");

    // Check should detect addition
    const result = await watcher.check();
    expect(result.changed).toBe(true);
    expect(result.added).toContain(`${tempDir}/file2.txt`);
    expect(result.deleted).toEqual([]);
    expect(result.modified).toEqual([]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("check() throws error for non-existent path", async () => {
  const watcher = new FileWatcher({ path: "/nonexistent/path/to/file.txt" });

  await expect(watcher.check()).rejects.toThrow();
});

Deno.test("getFiles() returns current cache", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/file1.txt`, "content1");

    const watcher = new FileWatcher({ path: tempDir });
    await watcher.check();

    const files = watcher.getFiles();
    expect(files.size).toBe(1);
    expect(files.has(`${tempDir}/file1.txt`)).toBe(true);

    const sig = files.get(`${tempDir}/file1.txt`);
    expect(sig?.size).toBe(8); // "content1" is 8 bytes
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("forceCheck() bypasses refresh interval", async () => {
  const tempFile = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(tempFile, "hello");

    const watcher = new FileWatcher({ path: tempFile, refreshInterval: 10000 });

    // First check
    await watcher.check();

    // Modify file
    await Deno.writeTextFile(tempFile, "modified");

    // Regular check should return no changes (rate limited)
    const result1 = await watcher.check();
    expect(result1.changed).toBe(false);

    // forceCheck should bypass rate limit and detect changes
    const result2 = await watcher.forceCheck();
    expect(result2.changed).toBe(true);
    expect(result2.modified).toContain(tempFile);
  } finally {
    await Deno.remove(tempFile);
  }
});
