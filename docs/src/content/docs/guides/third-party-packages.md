---
title: Third-Party Packages
description: How to import and use external packages in your function handlers
---

Function handlers in Crude Functions run on Deno, which uses URL-based imports. This guide covers how to import external packages from NPM, JSR, and other sources.

## Import Types

### NPM Packages

Import packages from NPM using the `npm:` prefix:

```typescript
import { camelCase } from "npm:lodash-es";
import dayjs from "npm:dayjs";

export default async function (c, ctx) {
  const formatted = camelCase("hello world");
  const date = dayjs().format("YYYY-MM-DD");
  return c.json({ formatted, date });
}
```

### JSR Packages

Import packages from [JSR](https://jsr.io) (JavaScript Registry) using the `jsr:` prefix:

```typescript
import { z } from "jsr:@zod/zod";

const UserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export default async function (c, ctx) {
  const body = await c.req.json();
  const result = UserSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.issues }, 400);
  }

  return c.json({ user: result.data }, 201);
}
```

### URL Imports

Import directly from URLs:

```typescript
import confetti from "https://esm.sh/canvas-confetti";

export default async function (c, ctx) {
  // Use the imported module
  return c.json({ loaded: true });
}
```

### Relative Imports

Import other files from your `code/` directory using relative paths:

```typescript
import { formatGreeting } from "./utils/formatting.ts";
import { validateInput } from "./validators.ts";

export default async function (c, ctx) {
  const greeting = formatGreeting("World");
  return c.json({ message: greeting });
}
```

## Important: Full Specifiers Required

You must use the full specifier prefix (`npm:`, `jsr:`, or a complete URL) for external packages. Short aliases like `"lodash"` or `"zod"` will not work:

```typescript
// Correct
import { z } from "jsr:@zod/zod";
import dayjs from "npm:dayjs";

// Will not work
import { z } from "zod";
import dayjs from "dayjs";
```

## Complete Example

Here's a handler that uses multiple import types:

```typescript
import { z } from "jsr:@zod/zod";
import dayjs from "npm:dayjs";
import { getUser } from "./utils/db.ts";

const QuerySchema = z.object({
  id: z.string().uuid(),
});

export default async function (c, ctx) {
  const result = QuerySchema.safeParse(ctx.query);

  if (!result.success) {
    return c.json({ error: "Invalid query parameters" }, 400);
  }

  const user = await getUser(result.data.id);

  return c.json({
    user,
    fetchedAt: dayjs().toISOString(),
  });
}
```

## What's Next

- Learn about the [Handler Context](/reference/handler-context) available to your functions
- Create [Your First Function](/guides/your-first-function) if you haven't already
