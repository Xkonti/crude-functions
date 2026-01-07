import { expect } from "@std/expect";
import { DatabaseService } from "./database_service.ts";
import { DatabaseNotOpenError, NestedTransactionError } from "./errors.ts";

async function createTestDb(): Promise<{ db: DatabaseService; tempDir: string }> {
  const tempDir = await Deno.makeTempDir();
  const dbPath = `${tempDir}/test.db`;
  const db = new DatabaseService({ databasePath: dbPath });
  return { db, tempDir };
}

async function cleanup(tempDir: string): Promise<void> {
  await Deno.remove(tempDir, { recursive: true });
}

// =====================
// Connection tests
// =====================

Deno.test("DatabaseService creates database file and directory", async () => {
  const tempDir = await Deno.makeTempDir();
  const dbPath = `${tempDir}/data/nested/test.db`;

  try {
    const db = new DatabaseService({ databasePath: dbPath });
    await db.open();

    // Verify file exists
    const stat = await Deno.stat(dbPath);
    expect(stat.isFile).toBe(true);

    await db.close();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DatabaseService.open is idempotent", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.open(); // Should not throw
    expect(db.isOpen).toBe(true);
    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService.close is idempotent", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.close();
    await db.close(); // Should not throw
    expect(db.isOpen).toBe(false);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService enables WAL mode by default", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();

    const result = await db.queryOne<{ journal_mode: string }>(
      "PRAGMA journal_mode"
    );
    expect(result?.journal_mode).toBe("wal");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService can disable WAL mode", async () => {
  const tempDir = await Deno.makeTempDir();
  const dbPath = `${tempDir}/test.db`;

  try {
    const db = new DatabaseService({
      databasePath: dbPath,
      enableWal: false,
    });
    await db.open();

    const result = await db.queryOne<{ journal_mode: string }>(
      "PRAGMA journal_mode"
    );
    // Without WAL, it defaults to "delete" journal mode
    expect(result?.journal_mode).not.toBe("wal");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService throws when operations called before open", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await expect(db.queryAll("SELECT 1")).rejects.toThrow(DatabaseNotOpenError);
    await expect(db.queryOne("SELECT 1")).rejects.toThrow(DatabaseNotOpenError);
    await expect(db.execute("SELECT 1")).rejects.toThrow(DatabaseNotOpenError);
    await expect(db.exec("SELECT 1")).rejects.toThrow(DatabaseNotOpenError);
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// Query execution tests
// =====================

Deno.test("DatabaseService.exec creates table", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

    // Verify table exists
    const result = await db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='test'"
    );
    expect(result?.name).toBe("test");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService.execute returns changes and lastInsertRowId", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

    const result = await db.execute(
      "INSERT INTO test (name) VALUES (?)",
      ["foo"]
    );
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowId).toBe(1);

    const result2 = await db.execute(
      "INSERT INTO test (name) VALUES (?)",
      ["bar"]
    );
    expect(result2.changes).toBe(1);
    expect(result2.lastInsertRowId).toBe(2);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService.queryAll returns multiple rows", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await db.execute("INSERT INTO test (name) VALUES (?)", ["foo"]);
    await db.execute("INSERT INTO test (name) VALUES (?)", ["bar"]);
    await db.execute("INSERT INTO test (name) VALUES (?)", ["baz"]);

    const rows = await db.queryAll<{ id: number; name: string }>(
      "SELECT * FROM test ORDER BY id"
    );

    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("foo");
    expect(rows[1].name).toBe("bar");
    expect(rows[2].name).toBe("baz");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService.queryAll returns empty array for no matches", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

    const rows = await db.queryAll("SELECT * FROM test");
    expect(rows).toEqual([]);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService.queryOne returns single row", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await db.execute("INSERT INTO test (name) VALUES (?)", ["foo"]);

    const row = await db.queryOne<{ id: number; name: string }>(
      "SELECT * FROM test WHERE id = ?",
      [1]
    );

    expect(row).not.toBeNull();
    expect(row?.id).toBe(1);
    expect(row?.name).toBe("foo");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService.queryOne returns null for no match", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

    const row = await db.queryOne("SELECT * FROM test WHERE id = ?", [999]);
    expect(row).toBeNull();

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService.execute handles UPDATE", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await db.execute("INSERT INTO test (name) VALUES (?)", ["foo"]);
    await db.execute("INSERT INTO test (name) VALUES (?)", ["bar"]);

    const result = await db.execute(
      "UPDATE test SET name = ? WHERE name = ?",
      ["updated", "foo"]
    );
    expect(result.changes).toBe(1);

    const row = await db.queryOne<{ name: string }>(
      "SELECT name FROM test WHERE id = ?",
      [1]
    );
    expect(row?.name).toBe("updated");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService.execute handles DELETE", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await db.execute("INSERT INTO test (name) VALUES (?)", ["foo"]);
    await db.execute("INSERT INTO test (name) VALUES (?)", ["bar"]);

    const result = await db.execute("DELETE FROM test WHERE name = ?", ["foo"]);
    expect(result.changes).toBe(1);

    const rows = await db.queryAll("SELECT * FROM test");
    expect(rows.length).toBe(1);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// Prepared statement tests
// =====================

Deno.test("PreparedStatement.run executes write operations", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

    const stmt = db.prepare("INSERT INTO test (name) VALUES (?)");
    try {
      await stmt.run(["foo"]);
      await stmt.run(["bar"]);
    } finally {
      stmt.finalize();
    }

    const rows = await db.queryAll("SELECT * FROM test");
    expect(rows.length).toBe(2);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("PreparedStatement.all returns rows", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await db.execute("INSERT INTO test (name) VALUES (?)", ["foo"]);
    await db.execute("INSERT INTO test (name) VALUES (?)", ["bar"]);

    const stmt = db.prepare("SELECT * FROM test WHERE name LIKE ?");
    try {
      const rows = await stmt.all<{ id: number; name: string }>(["%o%"]);
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("foo");
    } finally {
      stmt.finalize();
    }

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("PreparedStatement.get returns single row", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await db.execute("INSERT INTO test (name) VALUES (?)", ["foo"]);

    const stmt = db.prepare("SELECT * FROM test WHERE id = ?");
    try {
      const row = await stmt.get<{ id: number; name: string }>([1]);
      expect(row?.name).toBe("foo");

      const noRow = await stmt.get([999]);
      expect(noRow).toBeNull();
    } finally {
      stmt.finalize();
    }

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// Concurrency tests
// =====================

Deno.test("DatabaseService serializes concurrent writes", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER)");
    await db.execute("INSERT INTO counter (id, value) VALUES (1, 0)");

    // Launch 20 concurrent atomic increments
    // Using atomic SQL (value = value + 1) ensures each increment is self-contained
    const increments = Array.from({ length: 20 }, () =>
      db.execute("UPDATE counter SET value = value + 1 WHERE id = 1")
    );

    await Promise.all(increments);

    // Mutex serializes the writes, so all 20 increments should succeed
    const final = await db.queryOne<{ value: number }>(
      "SELECT value FROM counter WHERE id = 1"
    );
    expect(final?.value).toBe(20);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService allows concurrent reads", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await db.execute("INSERT INTO test (name) VALUES (?)", ["foo"]);

    // Launch 10 concurrent reads - should all succeed without blocking
    const reads = Array.from({ length: 10 }, () =>
      db.queryAll("SELECT * FROM test")
    );

    const results = await Promise.all(reads);

    // All reads should return the same result
    for (const result of results) {
      expect(result.length).toBe(1);
    }

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

// ============== Transaction Tests ==============

Deno.test("DatabaseService - transaction commits on success", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();

    // Create table outside transaction
    await db.exec("CREATE TABLE test (id INTEGER, value TEXT)");

    // Transaction with multiple operations
    await db.transaction(async (tx) => {
      await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [1, "first"]);
      await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [2, "second"]);
    });

    // Verify both inserts committed
    const rows = await db.queryAll<{ id: number; value: string }>(
      "SELECT * FROM test ORDER BY id"
    );
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ id: 1, value: "first" });
    expect(rows[1]).toEqual({ id: 2, value: "second" });

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService - transaction rolls back on error", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

    // Transaction that will fail
    try {
      await db.transaction(async (tx) => {
        await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [1, "first"]);
        await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [2, "second"]);
        // Duplicate primary key - will fail
        await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [1, "duplicate"]);
      });
    } catch {
      // Expected error
    }

    // Verify rollback - no data inserted
    const rows = await db.queryAll("SELECT * FROM test");
    expect(rows.length).toBe(0);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService - nested transaction throws error", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER)");

    await db.transaction(async (tx) => {
      await tx.execute("INSERT INTO test (id) VALUES (?)", [1]);

      // Attempt nested transaction - should throw
      try {
        await db.transaction(async (innerTx) => {
          await innerTx.execute("INSERT INTO test (id) VALUES (?)", [2]);
        });
        throw new Error("Should have thrown NestedTransactionError");
      } catch (error) {
        expect(error instanceof NestedTransactionError).toBe(true);
        expect((error as Error).message).toContain("not supported");
      }
    });

    // Verify outer transaction committed despite inner error
    const rows = await db.queryAll("SELECT * FROM test");
    expect(rows.length).toBe(1);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService - concurrent transactions serialize", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER, value TEXT)");

    const results: number[] = [];

    // Start two transactions concurrently
    const tx1 = db.transaction(async (tx) => {
      await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [1, "tx1-start"]);
      await new Promise(resolve => setTimeout(resolve, 50)); // Simulate work
      await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [2, "tx1-end"]);
      results.push(1);
    });

    const tx2 = db.transaction(async (tx) => {
      await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [3, "tx2-start"]);
      await tx.execute("INSERT INTO test (id, value) VALUES (?, ?)", [4, "tx2-end"]);
      results.push(2);
    });

    await Promise.all([tx1, tx2]);

    // Verify all inserts committed
    const rows = await db.queryAll("SELECT * FROM test ORDER BY id");
    expect(rows.length).toBe(4);

    // Verify serialization - tx1 completes before tx2 starts
    expect(results).toEqual([1, 2]);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DatabaseService - transaction reads see uncommitted changes", async () => {
  const { db, tempDir } = await createTestDb();

  try {
    await db.open();
    await db.exec("CREATE TABLE test (id INTEGER, value TEXT)");
    await db.execute("INSERT INTO test (id, value) VALUES (?, ?)", [1, "initial"]);

    await db.transaction(async (tx) => {
      // Update within transaction
      await tx.execute("UPDATE test SET value = ? WHERE id = ?", ["updated", 1]);

      // Read within same transaction - should see uncommitted change
      const row = await tx.queryOne<{ value: string }>(
        "SELECT value FROM test WHERE id = ?",
        [1]
      );
      expect(row?.value).toBe("updated");
    });

    // Verify committed
    const row = await db.queryOne<{ value: string }>(
      "SELECT value FROM test WHERE id = ?",
      [1]
    );
    expect(row?.value).toBe("updated");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

