---
title: "Example: REST API CRUD"
description: Complete CRUD API with validation and error handling
---

This example demonstrates building a complete REST API with full CRUD operations (Create, Read, Update, Delete, List), using TypeScript types, Zod validation, proper error handling, and shared utilities.

## What You'll Build

A task management API with the following endpoints:

- `GET /tasks` - List all tasks with pagination
- `GET /tasks/:id` - Get a single task by ID
- `POST /tasks` - Create a new task
- `PUT /tasks/:id` - Update an existing task
- `DELETE /tasks/:id` - Delete a task

## File Organization

Organize your code to keep handlers clean and reusable:

```
code/
  lib/
    database.ts          # In-memory database
    validators.ts        # Shared validation utilities
  types.ts               # Shared TypeScript types
  tasks/
    list.ts              # GET /tasks
    get.ts               # GET /tasks/:id
    create.ts            # POST /tasks
    update.ts            # PUT /tasks/:id
    delete.ts            # DELETE /tasks/:id
```

## Step 1: Shared Types

Create shared TypeScript types for consistency across all handlers:

```typescript
// code/types.ts
export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
}

export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
}
```

## Step 2: Database Utility

Create a simple in-memory database for demonstration (replace with a real database in production):

```typescript
// code/lib/database.ts
import type { Task } from "../types.ts";

class TaskDatabase {
  private tasks: Map<string, Task> = new Map();

  // Get all tasks
  getAll(): Task[] {
    return Array.from(this.tasks.values()).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // Get task by ID
  getById(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  // Create new task
  create(data: Omit<Task, "id" | "createdAt" | "updatedAt">): Task {
    const task: Task = {
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  // Update existing task
  update(id: string, data: Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    const updated: Task = {
      ...task,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(id, updated);
    return updated;
  }

  // Delete task
  delete(id: string): boolean {
    return this.tasks.delete(id);
  }

  // Count tasks
  count(): number {
    return this.tasks.size;
  }

  // Filter by status
  getByStatus(status: Task["status"]): Task[] {
    return this.getAll().filter((task) => task.status === status);
  }
}

// Single instance shared across all handlers
export const db = new TaskDatabase();
```

## Step 3: Validation Schemas

Create Zod schemas for input validation:

```typescript
// code/lib/validators.ts
import { z } from "npm:zod@3.22.4";

// Schema for creating a new task
export const CreateTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z.string().max(2000, "Description too long").optional().default(""),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

// Schema for updating a task (all fields optional)
export const UpdateTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long").optional(),
  description: z.string().max(2000, "Description too long").optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});

// Schema for pagination query parameters
export const PaginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1)).optional().default("1"),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).optional().default("20"),
});

// Helper function to validate UUID format
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
```

## Step 4: CRUD Handlers

### List Tasks (GET /tasks)

```typescript
// code/tasks/list.ts
import type { Task, PaginationInfo } from "../types.ts";
import { db } from "../lib/database.ts";
import { PaginationSchema } from "../lib/validators.ts";

export default async function (c, ctx) {
  try {
    // Parse and validate pagination parameters
    const queryResult = PaginationSchema.safeParse({
      page: ctx.query.page || "1",
      limit: ctx.query.limit || "20",
    });

    if (!queryResult.success) {
      return c.json({
        error: "Invalid pagination parameters",
        issues: queryResult.error.issues,
      }, 400);
    }

    const { page, limit } = queryResult.data;

    // Get all tasks
    const allTasks = db.getAll();
    const total = allTasks.length;

    // Calculate pagination
    const offset = (page - 1) * limit;
    const tasks = allTasks.slice(offset, offset + limit);

    // Build response with pagination info
    const pagination: PaginationInfo = {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };

    return c.json({
      data: tasks,
      pagination,
    });
  } catch (error) {
    console.error(`[${ctx.requestId}] Error listing tasks:`, error);
    return c.json({
      error: "Failed to list tasks",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### Get Task by ID (GET /tasks/:id)

```typescript
// code/tasks/get.ts
import { db } from "../lib/database.ts";
import { isValidUUID } from "../lib/validators.ts";

export default async function (c, ctx) {
  try {
    const taskId = ctx.params.id;

    // Validate UUID format
    if (!isValidUUID(taskId)) {
      return c.json({ error: "Invalid task ID format" }, 400);
    }

    // Get task from database
    const task = db.getById(taskId);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json({ data: task });
  } catch (error) {
    console.error(`[${ctx.requestId}] Error getting task:`, error);
    return c.json({
      error: "Failed to get task",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### Create Task (POST /tasks)

```typescript
// code/tasks/create.ts
import { db } from "../lib/database.ts";
import { CreateTaskSchema } from "../lib/validators.ts";

export default async function (c, ctx) {
  try {
    // Parse request body
    const body = await c.req.json();

    // Validate input
    const result = CreateTaskSchema.safeParse(body);

    if (!result.success) {
      return c.json({
        error: "Validation failed",
        issues: result.error.issues,
      }, 400);
    }

    // Create task in database
    const task = db.create(result.data);

    console.log(`[${ctx.requestId}] Created task: ${task.id}`);

    return c.json({
      data: task,
      message: "Task created successfully",
    }, 201);
  } catch (error) {
    console.error(`[${ctx.requestId}] Error creating task:`, error);

    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON in request body" }, 400);
    }

    return c.json({
      error: "Failed to create task",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### Update Task (PUT /tasks/:id)

```typescript
// code/tasks/update.ts
import { db } from "../lib/database.ts";
import { UpdateTaskSchema, isValidUUID } from "../lib/validators.ts";

export default async function (c, ctx) {
  try {
    const taskId = ctx.params.id;

    // Validate UUID format
    if (!isValidUUID(taskId)) {
      return c.json({ error: "Invalid task ID format" }, 400);
    }

    // Check if task exists
    const existingTask = db.getById(taskId);
    if (!existingTask) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Parse request body
    const body = await c.req.json();

    // Validate input
    const result = UpdateTaskSchema.safeParse(body);

    if (!result.success) {
      return c.json({
        error: "Validation failed",
        issues: result.error.issues,
      }, 400);
    }

    // Update task in database
    const updatedTask = db.update(taskId, result.data);

    console.log(`[${ctx.requestId}] Updated task: ${taskId}`);

    return c.json({
      data: updatedTask,
      message: "Task updated successfully",
    });
  } catch (error) {
    console.error(`[${ctx.requestId}] Error updating task:`, error);

    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON in request body" }, 400);
    }

    return c.json({
      error: "Failed to update task",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### Delete Task (DELETE /tasks/:id)

```typescript
// code/tasks/delete.ts
import { db } from "../lib/database.ts";
import { isValidUUID } from "../lib/validators.ts";

export default async function (c, ctx) {
  try {
    const taskId = ctx.params.id;

    // Validate UUID format
    if (!isValidUUID(taskId)) {
      return c.json({ error: "Invalid task ID format" }, 400);
    }

    // Check if task exists
    const existingTask = db.getById(taskId);
    if (!existingTask) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Delete task from database
    const deleted = db.delete(taskId);

    if (!deleted) {
      return c.json({ error: "Failed to delete task" }, 500);
    }

    console.log(`[${ctx.requestId}] Deleted task: ${taskId}`);

    return c.json({
      message: "Task deleted successfully",
    });
  } catch (error) {
    console.error(`[${ctx.requestId}] Error deleting task:`, error);
    return c.json({
      error: "Failed to delete task",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

## Step 5: Register Routes

Use the web UI or API to register each handler as a route:

| Name | Route | Method | Handler | Description |
|------|-------|--------|---------|-------------|
| list-tasks | `/tasks` | GET | `tasks/list.ts` | List all tasks with pagination |
| get-task | `/tasks/:id` | GET | `tasks/get.ts` | Get a single task by ID |
| create-task | `/tasks` | POST | `tasks/create.ts` | Create a new task |
| update-task | `/tasks/:id` | PUT | `tasks/update.ts` | Update an existing task |
| delete-task | `/tasks/:id` | DELETE | `tasks/delete.ts` | Delete a task |

**Via Web UI:**
1. Navigate to Functions page
2. Click "New Function"
3. Fill in the route details
4. Save

**Via API:**

```bash
# List tasks
curl -X POST http://localhost:8000/api/functions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-management-key" \
  -d '{
    "name": "list-tasks",
    "route": "/tasks",
    "methods": ["GET"],
    "handler": "tasks/list.ts",
    "description": "List all tasks with pagination",
    "keys": []
  }'

# Get task
curl -X POST http://localhost:8000/api/functions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-management-key" \
  -d '{
    "name": "get-task",
    "route": "/tasks/:id",
    "methods": ["GET"],
    "handler": "tasks/get.ts",
    "description": "Get a single task by ID",
    "keys": []
  }'

# Create task
curl -X POST http://localhost:8000/api/functions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-management-key" \
  -d '{
    "name": "create-task",
    "route": "/tasks",
    "methods": ["POST"],
    "handler": "tasks/create.ts",
    "description": "Create a new task",
    "keys": []
  }'

# Update task
curl -X POST http://localhost:8000/api/functions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-management-key" \
  -d '{
    "name": "update-task",
    "route": "/tasks/:id",
    "methods": ["PUT"],
    "handler": "tasks/update.ts",
    "description": "Update an existing task",
    "keys": []
  }'

# Delete task
curl -X POST http://localhost:8000/api/functions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-management-key" \
  -d '{
    "name": "delete-task",
    "route": "/tasks/:id",
    "methods": ["DELETE"],
    "handler": "tasks/delete.ts",
    "description": "Delete a task",
    "keys": []
  }'
```

## Step 6: Test with curl

### Create a new task

```bash
curl -X POST http://localhost:8000/run/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Write documentation",
    "description": "Complete the REST API CRUD example",
    "status": "in_progress",
    "priority": "high"
  }'
```

Response:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Write documentation",
    "description": "Complete the REST API CRUD example",
    "status": "in_progress",
    "priority": "high",
    "createdAt": "2026-01-12T10:30:00.000Z",
    "updatedAt": "2026-01-12T10:30:00.000Z"
  },
  "message": "Task created successfully"
}
```

### List all tasks

```bash
curl http://localhost:8000/run/tasks
```

Response:
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Write documentation",
      "description": "Complete the REST API CRUD example",
      "status": "in_progress",
      "priority": "high",
      "createdAt": "2026-01-12T10:30:00.000Z",
      "updatedAt": "2026-01-12T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "pages": 1
  }
}
```

### Get a specific task

```bash
curl http://localhost:8000/run/tasks/550e8400-e29b-41d4-a716-446655440000
```

Response:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Write documentation",
    "description": "Complete the REST API CRUD example",
    "status": "in_progress",
    "priority": "high",
    "createdAt": "2026-01-12T10:30:00.000Z",
    "updatedAt": "2026-01-12T10:30:00.000Z"
  }
}
```

### Update a task

```bash
curl -X PUT http://localhost:8000/run/tasks/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "done"
  }'
```

Response:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Write documentation",
    "description": "Complete the REST API CRUD example",
    "status": "done",
    "priority": "high",
    "createdAt": "2026-01-12T10:30:00.000Z",
    "updatedAt": "2026-01-12T10:35:00.000Z"
  },
  "message": "Task updated successfully"
}
```

### Delete a task

```bash
curl -X DELETE http://localhost:8000/run/tasks/550e8400-e29b-41d4-a716-446655440000
```

Response:
```json
{
  "message": "Task deleted successfully"
}
```

### Test pagination

```bash
# Get first page with 5 items per page
curl "http://localhost:8000/run/tasks?page=1&limit=5"

# Get second page
curl "http://localhost:8000/run/tasks?page=2&limit=5"
```

### Test validation errors

```bash
# Missing title
curl -X POST http://localhost:8000/run/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "description": "This will fail"
  }'
```

Response:
```json
{
  "error": "Validation failed",
  "issues": [
    {
      "code": "invalid_type",
      "expected": "string",
      "received": "undefined",
      "path": ["title"],
      "message": "Title is required"
    }
  ]
}
```

```bash
# Invalid status
curl -X POST http://localhost:8000/run/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test",
    "status": "invalid_status"
  }'
```

Response:
```json
{
  "error": "Validation failed",
  "issues": [
    {
      "code": "invalid_enum_value",
      "options": ["todo", "in_progress", "done"],
      "path": ["status"],
      "message": "Invalid enum value. Expected 'todo' | 'in_progress' | 'done', received 'invalid_status'"
    }
  ]
}
```

```bash
# Invalid UUID
curl http://localhost:8000/run/tasks/not-a-uuid
```

Response:
```json
{
  "error": "Invalid task ID format"
}
```

```bash
# Task not found
curl http://localhost:8000/run/tasks/550e8400-e29b-41d4-a716-446655440099
```

Response:
```json
{
  "error": "Task not found"
}
```

## Error Handling Patterns

This example demonstrates several error handling best practices:

### Input Validation
- UUID format validation before database queries
- Zod schema validation for request bodies
- Pagination parameter validation
- Clear error messages with field-level details

### HTTP Status Codes
- `200` - Successful GET, PUT, DELETE
- `201` - Successfully created resource
- `400` - Validation errors or invalid input
- `404` - Resource not found
- `500` - Internal server errors

### Error Responses
All errors follow a consistent structure:

```typescript
{
  "error": "Human-readable error message",
  "issues": [...],  // Optional: validation details
  "requestId": "..." // Optional: for 500 errors
}
```

### Try-Catch Blocks
All handlers wrap operations in try-catch blocks to handle unexpected errors gracefully, preventing crashes and providing useful error context.

### Logging
All operations are logged with request IDs for traceability:

```typescript
console.log(`[${ctx.requestId}] Created task: ${task.id}`);
console.error(`[${ctx.requestId}] Error creating task:`, error);
```

## Extending This Example

### Add Authentication
Require API keys for certain operations:

```typescript
// Register route with key groups
{
  "name": "create-task",
  "route": "/tasks",
  "methods": ["POST"],
  "handler": "tasks/create.ts",
  "keys": [1, 2]  // Require keys from groups 1 or 2
}
```

### Add Filtering
Filter tasks by status or priority:

```typescript
// code/tasks/list.ts
const status = ctx.query.status;
const tasks = status ? db.getByStatus(status) : db.getAll();
```

Test:
```bash
curl "http://localhost:8000/run/tasks?status=done"
```

### Add Sorting
Sort tasks by different fields:

```typescript
const sortBy = ctx.query.sortBy || "createdAt";
const sortOrder = ctx.query.order || "desc";

const tasks = db.getAll().sort((a, b) => {
  const aVal = a[sortBy];
  const bVal = b[sortBy];
  return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
});
```

Test:
```bash
curl "http://localhost:8000/run/tasks?sortBy=priority&order=desc"
```

### Add Search
Search tasks by title or description:

```typescript
const search = ctx.query.q;
const tasks = db.getAll().filter((task) =>
  task.title.toLowerCase().includes(search.toLowerCase()) ||
  task.description.toLowerCase().includes(search.toLowerCase())
);
```

Test:
```bash
curl "http://localhost:8000/run/tasks?q=documentation"
```

### Use a Real Database
Replace the in-memory database with SQLite, PostgreSQL, or any other database:

```typescript
// code/lib/database.ts
import { Client } from "npm:pg";

export async function getTasks() {
  const client = new Client(DATABASE_URL);
  await client.connect();
  const result = await client.query("SELECT * FROM tasks");
  await client.end();
  return result.rows;
}
```

## Next Steps

- Learn about [API Keys and Authentication](/guides/api-keys) to protect your endpoints
- Explore [Secrets Management](/guides/secrets) to store database credentials
- Review [Error Handling](/guides/writing-functions#error-handling) best practices
- Check out other examples in the [Examples Gallery](/guides/examples)
