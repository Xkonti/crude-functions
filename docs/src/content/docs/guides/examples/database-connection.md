---
title: "Example: Database Connection"
description: Connecting to external databases with connection pooling
---

This guide demonstrates how to connect Crude Functions to external databases like PostgreSQL and MySQL. You'll learn connection pooling patterns, credential management with secrets, query execution, error handling, and production-ready database practices.

## What We'll Build

Database integration handlers that:
- Connect to PostgreSQL and MySQL databases
- Use connection pooling for efficiency
- Store credentials securely using secrets
- Execute CRUD operations (Create, Read, Update, Delete)
- Handle connection errors gracefully
- Support multi-tenant database isolation

## Prerequisites

Before starting, make sure you have:
- Crude Functions running and configured
- A PostgreSQL or MySQL database (local or remote)
- Database credentials (connection string, username, password)
- Basic understanding of [secrets management](/guides/secrets)
- Familiarity with SQL queries

## Overview: Database Connections in Functions

Unlike traditional servers that maintain persistent database connections, serverless functions create and destroy connections on demand. This makes connection pooling critical for performance.

**Key patterns:**

- **Module-level singleton:** Create pool once at module load time
- **Lazy initialization:** Connect only when first request arrives
- **Connection reuse:** Pool connections across multiple function invocations
- **Graceful degradation:** Handle connection failures without crashing

## PostgreSQL Connection

### Step 1: Install PostgreSQL Client

PostgreSQL uses the `pg` package (or `postgres.js` for a lighter alternative).

```typescript
// code/lib/postgres.ts
import { Pool } from "npm:pg@8.11.3";

interface DatabasePool {
  query(sql: string, params?: any[]): Promise<any>;
  end(): Promise<void>;
}

class PostgresPool implements DatabasePool {
  private pool: Pool | null = null;
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private ensurePool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        max: 10, // Maximum pool size
        idleTimeoutMillis: 30000, // Close idle connections after 30s
        connectionTimeoutMillis: 2000, // Fail fast if can't connect
      });

      // Log pool errors
      this.pool.on("error", (err) => {
        console.error("PostgreSQL pool error:", err);
      });
    }

    return this.pool;
  }

  async query(sql: string, params: any[] = []): Promise<any> {
    const pool = this.ensurePool();
    const result = await pool.query(sql, params);
    return result;
  }

  async end(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

// Module-level singleton (initialized lazily)
let dbPool: PostgresPool | null = null;

export async function getDatabase(ctx: any): Promise<DatabasePool> {
  if (!dbPool) {
    // Get connection string from secrets
    const connectionString = await ctx.getSecret("DATABASE_URL");

    if (!connectionString) {
      throw new Error("DATABASE_URL secret not configured");
    }

    // Initialize pool once
    dbPool = new PostgresPool(connectionString);
    console.log("PostgreSQL connection pool initialized");
  }

  return dbPool;
}
```

### Step 2: Store Database Credentials

Store your PostgreSQL connection string as a secret.

**Connection string format:**
```
postgresql://username:password@hostname:port/database?options
```

**Example:**
```
postgresql://myuser:mypassword@localhost:5432/mydb
postgresql://user:pass@db.example.com:5432/production?ssl=true
```

**Using Web UI:**

1. Navigate to `http://localhost:8000/web/secrets`
2. Click **"Add Secret"**
3. Fill in:
   - **Name**: `DATABASE_URL`
   - **Value**: `postgresql://user:pass@host:5432/database`
   - **Scope**: `Global` (or function-scoped for specific functions)
   - **Comment**: "PostgreSQL connection string - production database"
4. Click **"Create"**

**Using API:**

```bash
curl -X POST http://localhost:8000/api/secrets \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DATABASE_URL",
    "value": "postgresql://username:password@localhost:5432/mydb",
    "scope": "global",
    "comment": "PostgreSQL connection string"
  }'
```

:::tip[SSL Connections]
For production databases, always use SSL: `postgresql://user:pass@host:5432/db?sslmode=require`
:::

### Step 3: Create CRUD Operations

**List users:**

```typescript
// code/users/list.ts
import { getDatabase } from "../lib/postgres.ts";

export default async function (c, ctx) {
  try {
    const db = await getDatabase(ctx);

    // Parse pagination parameters
    const page = parseInt(ctx.query.page || "1");
    const limit = Math.min(parseInt(ctx.query.limit || "20"), 100); // Cap at 100
    const offset = (page - 1) * limit;

    // Query users with pagination
    const result = await db.query(
      `SELECT id, name, email, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Get total count
    const countResult = await db.query(
      "SELECT COUNT(*) as total FROM users"
    );

    const total = parseInt(countResult.rows[0].total);

    return c.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(`[${ctx.requestId}] Database error:`, error);
    return c.json({
      error: "Failed to fetch users",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

**Get user by ID:**

```typescript
// code/users/get.ts
import { getDatabase } from "../lib/postgres.ts";

export default async function (c, ctx) {
  try {
    const db = await getDatabase(ctx);
    const userId = ctx.params.id;

    // Validate UUID format
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(userId)) {
      return c.json({ error: "Invalid user ID format" }, 400);
    }

    // Query user by ID
    const result = await db.query(
      `SELECT id, name, email, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json(result.rows[0]);
  } catch (error) {
    console.error(`[${ctx.requestId}] Database error:`, error);
    return c.json({
      error: "Failed to fetch user",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

**Create user:**

```typescript
// code/users/create.ts
import { getDatabase } from "../lib/postgres.ts";
import { z } from "npm:zod@3.22.4";

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

export default async function (c, ctx) {
  try {
    // Validate request body
    const body = await c.req.json();
    const result = CreateUserSchema.safeParse(body);

    if (!result.success) {
      return c.json({
        error: "Validation failed",
        issues: result.error.issues,
      }, 400);
    }

    const { name, email } = result.data;
    const db = await getDatabase(ctx);

    // Check if email already exists
    const existingResult = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingResult.rows.length > 0) {
      return c.json({ error: "Email already in use" }, 409);
    }

    // Insert new user
    const insertResult = await db.query(
      `INSERT INTO users (id, name, email, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
       RETURNING id, name, email, created_at`,
      [name, email]
    );

    const user = insertResult.rows[0];
    console.log(`[${ctx.requestId}] Created user: ${user.id}`);

    return c.json(user, 201);
  } catch (error) {
    console.error(`[${ctx.requestId}] Database error:`, error);

    // Check for unique constraint violation (alternative to pre-check)
    if (error.code === "23505") { // PostgreSQL unique violation code
      return c.json({ error: "Email already in use" }, 409);
    }

    return c.json({
      error: "Failed to create user",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

**Update user:**

```typescript
// code/users/update.ts
import { getDatabase } from "../lib/postgres.ts";
import { z } from "npm:zod@3.22.4";

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
});

export default async function (c, ctx) {
  try {
    const userId = ctx.params.id;
    const body = await c.req.json();
    const result = UpdateUserSchema.safeParse(body);

    if (!result.success) {
      return c.json({
        error: "Validation failed",
        issues: result.error.issues,
      }, 400);
    }

    // Build dynamic UPDATE query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (result.data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(result.data.name);
    }

    if (result.data.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(result.data.email);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const db = await getDatabase(ctx);

    // Execute update
    const updateResult = await db.query(
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING id, name, email, created_at, updated_at`,
      values
    );

    if (updateResult.rows.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }

    console.log(`[${ctx.requestId}] Updated user: ${userId}`);
    return c.json(updateResult.rows[0]);
  } catch (error) {
    console.error(`[${ctx.requestId}] Database error:`, error);

    if (error.code === "23505") {
      return c.json({ error: "Email already in use" }, 409);
    }

    return c.json({
      error: "Failed to update user",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

**Delete user:**

```typescript
// code/users/delete.ts
import { getDatabase } from "../lib/postgres.ts";

export default async function (c, ctx) {
  try {
    const userId = ctx.params.id;
    const db = await getDatabase(ctx);

    // Delete user
    const result = await db.query(
      "DELETE FROM users WHERE id = $1 RETURNING id",
      [userId]
    );

    if (result.rows.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }

    console.log(`[${ctx.requestId}] Deleted user: ${userId}`);
    return c.json({ message: "User deleted" });
  } catch (error) {
    console.error(`[${ctx.requestId}] Database error:`, error);
    return c.json({
      error: "Failed to delete user",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### Step 4: Create Database Schema

Run this SQL to create the users table:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index for email lookups
CREATE INDEX idx_users_email ON users(email);

-- Create index for created_at sorting
CREATE INDEX idx_users_created_at ON users(created_at DESC);
```

## MySQL Connection

### Step 1: Install MySQL Client

```typescript
// code/lib/mysql.ts
import { createPool, type Pool } from "npm:mysql2@3.9.1/promise";

interface DatabasePool {
  query(sql: string, params?: any[]): Promise<any>;
  end(): Promise<void>;
}

class MySQLPool implements DatabasePool {
  private pool: Pool | null = null;
  private connectionConfig: any;

  constructor(connectionString: string) {
    // Parse MySQL connection string
    // Format: mysql://user:pass@host:port/database
    const url = new URL(connectionString);
    this.connectionConfig = {
      host: url.hostname,
      port: parseInt(url.port || "3306"),
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1), // Remove leading /
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    };
  }

  private ensurePool(): Pool {
    if (!this.pool) {
      this.pool = createPool(this.connectionConfig);
      console.log("MySQL connection pool initialized");
    }
    return this.pool;
  }

  async query(sql: string, params: any[] = []): Promise<any> {
    const pool = this.ensurePool();
    const [rows] = await pool.execute(sql, params);
    return { rows };
  }

  async end(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

// Module-level singleton
let dbPool: MySQLPool | null = null;

export async function getDatabase(ctx: any): Promise<DatabasePool> {
  if (!dbPool) {
    const connectionString = await ctx.getSecret("DATABASE_URL");

    if (!connectionString) {
      throw new Error("DATABASE_URL secret not configured");
    }

    dbPool = new MySQLPool(connectionString);
  }

  return dbPool;
}
```

### Step 2: Store MySQL Credentials

**Connection string format:**
```
mysql://username:password@hostname:port/database
```

**Example:**
```
mysql://myuser:mypassword@localhost:3306/mydb
mysql://user:pass@db.example.com:3306/production
```

Store as a secret (same process as PostgreSQL):

```bash
curl -X POST http://localhost:8000/api/secrets \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DATABASE_URL",
    "value": "mysql://username:password@localhost:3306/mydb",
    "scope": "global",
    "comment": "MySQL connection string"
  }'
```

### Step 3: MySQL CRUD Operations

The handler code is nearly identical to PostgreSQL, just change the import:

```typescript
// code/users/list-mysql.ts
import { getDatabase } from "../lib/mysql.ts"; // MySQL instead of postgres

export default async function (c, ctx) {
  try {
    const db = await getDatabase(ctx);

    const page = parseInt(ctx.query.page || "1");
    const limit = Math.min(parseInt(ctx.query.limit || "20"), 100);
    const offset = (page - 1) * limit;

    // MySQL uses ? placeholders instead of $1, $2
    const result = await db.query(
      `SELECT id, name, email, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const countResult = await db.query("SELECT COUNT(*) as total FROM users");
    const total = countResult.rows[0].total;

    return c.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(`[${ctx.requestId}] Database error:`, error);
    return c.json({
      error: "Failed to fetch users",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

**Key differences from PostgreSQL:**

- **Placeholders:** MySQL uses `?` instead of `$1, $2, ...`
- **UUIDs:** MySQL requires `CHAR(36)` or `BINARY(16)` for UUIDs
- **NOW():** Same as PostgreSQL
- **Auto-increment:** MySQL uses `AUTO_INCREMENT` instead of `gen_random_uuid()`

### Step 4: MySQL Schema

```sql
CREATE TABLE users (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Connection Pooling Explained

### Why Connection Pooling?

Without pooling, each function invocation:
1. Opens a new database connection (slow, ~50-200ms)
2. Executes query
3. Closes connection

With pooling:
1. Reuses existing connection from pool (fast, ~1-5ms)
2. Executes query
3. Returns connection to pool for reuse

**Performance impact:**
- **Without pool:** 200ms per request
- **With pool:** 5ms per request
- **Improvement:** 40x faster

### Module-Level Singleton Pattern

```typescript
// Module-level variable (shared across invocations)
let dbPool: DatabasePool | null = null;

export async function getDatabase(ctx: any): Promise<DatabasePool> {
  // Initialize once on first call
  if (!dbPool) {
    const connectionString = await ctx.getSecret("DATABASE_URL");
    dbPool = new DatabasePool(connectionString);
    console.log("Pool initialized"); // Logs only once
  }

  // Reuse on subsequent calls
  return dbPool;
}
```

**How it works:**

1. First request: `dbPool` is `null`, so initialize pool
2. Subsequent requests: `dbPool` already exists, return immediately
3. Pool persists across function invocations (until process restarts)
4. Connections are reused efficiently

### Pool Configuration

**PostgreSQL (pg):**

```typescript
new Pool({
  connectionString: "...",
  max: 10,                      // Maximum connections
  idleTimeoutMillis: 30000,     // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Fail fast if can't connect
})
```

**MySQL (mysql2):**

```typescript
createPool({
  host: "...",
  user: "...",
  password: "...",
  database: "...",
  connectionLimit: 10,     // Maximum connections
  waitForConnections: true, // Queue requests when pool is full
  queueLimit: 0,           // Unlimited queue size
})
```

**Recommended settings:**

- **max/connectionLimit:** 10 (for single-instance deployments)
- **idleTimeout:** 30 seconds (balance between reuse and resource usage)
- **connectionTimeout:** 2 seconds (fail fast, don't wait indefinitely)

## Error Handling Best Practices

### Handle Connection Failures

```typescript
export default async function (c, ctx) {
  try {
    const db = await getDatabase(ctx);
    const result = await db.query("SELECT * FROM users");
    return c.json({ users: result.rows });
  } catch (error) {
    console.error(`[${ctx.requestId}] Database error:`, error);

    // Check for specific error types
    if (error.code === "ECONNREFUSED") {
      return c.json({ error: "Database unavailable" }, 503);
    }

    if (error.code === "ETIMEDOUT") {
      return c.json({ error: "Database timeout" }, 504);
    }

    // Generic database error
    return c.json({
      error: "Database operation failed",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### Validate Query Results

```typescript
// Check if results exist before accessing
const result = await db.query("SELECT * FROM users WHERE id = $1", [userId]);

if (result.rows.length === 0) {
  return c.json({ error: "User not found" }, 404);
}

const user = result.rows[0];
```

### Handle Database Constraint Violations

```typescript
try {
  await db.query(
    "INSERT INTO users (email) VALUES ($1)",
    [email]
  );
} catch (error) {
  // PostgreSQL unique constraint violation
  if (error.code === "23505") {
    return c.json({ error: "Email already exists" }, 409);
  }

  // MySQL duplicate entry
  if (error.code === "ER_DUP_ENTRY") {
    return c.json({ error: "Email already exists" }, 409);
  }

  // Other errors
  throw error;
}
```

### Retry Transient Errors

```typescript
async function queryWithRetry(
  db: DatabasePool,
  sql: string,
  params: any[],
  maxRetries = 3
): Promise<any> {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await db.query(sql, params);
    } catch (error) {
      lastError = error;

      // Only retry on transient errors
      const transientErrors = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND"];
      if (!transientErrors.includes(error.code)) {
        throw error; // Non-transient error, fail immediately
      }

      console.warn(`Query attempt ${attempt} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // Exponential backoff
    }
  }

  throw lastError; // All retries exhausted
}
```

## Multi-Tenant Database Isolation

Use key-scoped secrets to provide different database connections per customer:

```typescript
// code/lib/postgres-multitenant.ts
import { Pool } from "npm:pg@8.11.3";

const pools = new Map<string, Pool>();

export async function getDatabase(ctx: any): Promise<any> {
  // Get tenant-specific connection string
  const tenantId = await ctx.getSecret("TENANT_ID");
  const connectionString = await ctx.getSecret("DATABASE_URL");

  if (!tenantId || !connectionString) {
    throw new Error("Tenant not configured");
  }

  // One pool per tenant
  if (!pools.has(tenantId)) {
    const pool = new Pool({
      connectionString,
      max: 5, // Smaller pool per tenant
    });

    pools.set(tenantId, pool);
    console.log(`Initialized pool for tenant: ${tenantId}`);
  }

  return {
    query: async (sql: string, params: any[] = []) => {
      const pool = pools.get(tenantId)!;
      return await pool.query(sql, params);
    },
  };
}
```

**Secret configuration:**

Each API key has key-scoped secrets:
- `TENANT_ID`: `"customer-123"`
- `DATABASE_URL`: `"postgresql://user:pass@db.example.com/customer_123"`

```typescript
// code/users/list-multitenant.ts
import { getDatabase } from "../lib/postgres-multitenant.ts";

export default async function (c, ctx) {
  try {
    // Automatically uses tenant-specific database
    const db = await getDatabase(ctx);
    const result = await db.query("SELECT * FROM users");

    console.log(`[${ctx.requestId}] Queried ${result.rows.length} users for tenant`);

    return c.json({ users: result.rows });
  } catch (error) {
    console.error(`[${ctx.requestId}] Database error:`, error);
    return c.json({ error: "Database operation failed" }, 500);
  }
}
```

## Advanced Patterns

### Transactions

```typescript
// code/users/transfer-credits.ts
import { getDatabase } from "../lib/postgres.ts";

export default async function (c, ctx) {
  const { fromUserId, toUserId, amount } = await c.req.json();
  const db = await getDatabase(ctx);

  try {
    // Begin transaction
    await db.query("BEGIN");

    // Deduct from sender
    await db.query(
      "UPDATE users SET credits = credits - $1 WHERE id = $2",
      [amount, fromUserId]
    );

    // Add to receiver
    await db.query(
      "UPDATE users SET credits = credits + $1 WHERE id = $2",
      [amount, toUserId]
    );

    // Commit transaction
    await db.query("COMMIT");

    console.log(`[${ctx.requestId}] Transferred ${amount} credits: ${fromUserId} -> ${toUserId}`);

    return c.json({ success: true });
  } catch (error) {
    // Rollback on error
    await db.query("ROLLBACK");

    console.error(`[${ctx.requestId}] Transaction failed:`, error);
    return c.json({ error: "Transfer failed" }, 500);
  }
}
```

### Query Timeouts

```typescript
// Set query timeout to prevent long-running queries
const result = await db.query(
  "SET LOCAL statement_timeout TO '5s'"
);

// Execute query (will be killed after 5 seconds)
const users = await db.query("SELECT * FROM users");
```

### Prepared Statements

```typescript
// PostgreSQL automatically uses prepared statements with parameterized queries
const result = await db.query(
  "SELECT * FROM users WHERE email = $1 AND active = $2",
  [email, true]
);

// This is safe from SQL injection
```

### Connection Health Checks

```typescript
// code/health/database.ts
import { getDatabase } from "../lib/postgres.ts";

export default async function (c, ctx) {
  try {
    const db = await getDatabase(ctx);

    const startTime = Date.now();
    await db.query("SELECT 1");
    const duration = Date.now() - startTime;

    return c.json({
      status: "healthy",
      latency: `${duration}ms`,
    });
  } catch (error) {
    console.error(`[${ctx.requestId}] Database health check failed:`, error);
    return c.json({
      status: "unhealthy",
      error: error.message,
    }, 503);
  }
}
```

## Security Best Practices

### 1. Always Use Parameterized Queries

```typescript
// ✅ Good: Parameterized (safe from SQL injection)
await db.query("SELECT * FROM users WHERE email = $1", [userEmail]);

// ❌ Bad: String concatenation (vulnerable to SQL injection)
await db.query(`SELECT * FROM users WHERE email = '${userEmail}'`);
```

### 2. Use SSL for Production Databases

```typescript
// PostgreSQL with SSL
postgresql://user:pass@host:5432/db?sslmode=require

// MySQL with SSL
mysql://user:pass@host:3306/db?ssl=true
```

### 3. Use Read Replicas for Scaling

```typescript
// Store separate connection strings for read and write operations
const readDb = await ctx.getSecret("DATABASE_READ_URL");
const writeDb = await ctx.getSecret("DATABASE_WRITE_URL");

// Use read replica for queries
const users = await readPool.query("SELECT * FROM users");

// Use primary for writes
await writePool.query("INSERT INTO users ...");
```

### 4. Validate Input Before Querying

```typescript
import { z } from "npm:zod@3.22.4";

const UserIdSchema = z.string().uuid();

const result = UserIdSchema.safeParse(userId);
if (!result.success) {
  return c.json({ error: "Invalid user ID" }, 400);
}

// Safe to use in query
await db.query("SELECT * FROM users WHERE id = $1", [result.data]);
```

### 5. Limit Query Results

```typescript
// Always use LIMIT to prevent accidentally returning huge datasets
const limit = Math.min(parseInt(ctx.query.limit || "20"), 100);
await db.query("SELECT * FROM users LIMIT $1", [limit]);
```

### 6. Rotate Database Credentials Regularly

Update `DATABASE_URL` secret periodically (e.g., every 90 days):

```bash
curl -X PUT http://localhost:8000/api/secrets/:id \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "value": "postgresql://newuser:newpass@host:5432/db",
    "comment": "Rotated credentials - 2026-04-15"
  }'
```

## Testing Your Database Functions

### Test Locally with Docker

Run a test database using Docker:

**PostgreSQL:**
```bash
docker run --name test-postgres \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  -d postgres:16

# Connection string
postgresql://postgres:testpass@localhost:5432/testdb
```

**MySQL:**
```bash
docker run --name test-mysql \
  -e MYSQL_ROOT_PASSWORD=testpass \
  -e MYSQL_DATABASE=testdb \
  -p 3306:3306 \
  -d mysql:8.3

# Connection string
mysql://root:testpass@localhost:3306/testdb
```

### Test CRUD Operations with curl

```bash
# Create user
curl -X POST http://localhost:8000/run/users/create \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com"}'

# List users
curl http://localhost:8000/run/users/list

# Get user by ID
curl http://localhost:8000/run/users/get/123e4567-e89b-12d3-a456-426614174000

# Update user
curl -X PUT http://localhost:8000/run/users/update/123e4567-e89b-12d3-a456-426614174000 \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane Doe"}'

# Delete user
curl -X DELETE http://localhost:8000/run/users/delete/123e4567-e89b-12d3-a456-426614174000
```

## Troubleshooting

### Connection Refused

**Cause:** Database not running or wrong hostname/port

**Solutions:**
- Verify database is running: `psql` or `mysql` CLI
- Check connection string: hostname, port, database name
- Test connection: `telnet hostname port`
- Check firewall rules

### Connection Timeout

**Cause:** Database not responding or network issues

**Solutions:**
- Increase `connectionTimeoutMillis` in pool config
- Check database load (CPU, memory)
- Test network latency: `ping hostname`

### Too Many Connections

**Cause:** Pool size exceeds database max connections

**Solutions:**
- Reduce pool `max` setting
- Increase database `max_connections` setting
- Check for connection leaks (connections not released)

### Query Returns Empty Results

**Cause:** Query syntax or table empty

**Solutions:**
- Test query directly in database CLI
- Check table has data: `SELECT COUNT(*) FROM users`
- Verify column names match schema

### Authentication Failed

**Cause:** Wrong username, password, or database name

**Solutions:**
- Verify credentials in connection string
- Test connection with CLI
- Check database user permissions

## Related Topics

- [Secrets Management](/guides/secrets) - Storing database credentials securely
- [Writing Functions](/guides/writing-functions) - Complete handler reference
- [Error Handling](/guides/error-handling) - Handling database errors gracefully
- [API Reference](/reference/api) - Management API for secrets and functions
