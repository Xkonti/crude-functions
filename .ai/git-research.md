# Git Integration Library Research

## Overview

This document summarizes research on using `isomorphic-git` for the Code Sources feature in Crude Functions.

---

## 1. Deno Compatibility

### Current Status: Broken in Latest Versions

**Issue:** [Explicit use of path-browserify breaks isomorphic-git on Deno #2004](https://github.com/isomorphic-git/isomorphic-git/issues/2004)

- **Breaking change introduced:** v1.27.2 (via PR #1958)
- **Last working version:** v1.27.1
- **Issue status:** Still open as of November 2025, with PR #2035 proposed but not merged

**Root cause:** Version 1.27.2 switched to explicit `path-browserify` import which uses CommonJS exports. When Deno tries to import via ESM syntax, named exports aren't available.

**Error message:**
```
SyntaxError: The requested module 'path-browserify' does not provide an export named 'join'
```

### Recommended Approach

**Pin to version 1.27.1:**
```typescript
import git from "npm:isomorphic-git@1.27.1";
import http from "npm:isomorphic-git@1.27.1/http/node";
```

### Alternative: iso-git Wrapper

[iso-git](https://next-nest-test.vercel.app/x/iso-git) is a Deno-specific wrapper:

```typescript
import { git, http, fs } from 'https://x.nest.land/iso-git@0.1.7/mod.ts'
```

**Caution:** Last updated July 2021, may be outdated.

### Additional Compatibility Note

There's a [separate node:fs issue](https://github.com/denoland/deno/issues/21795) where `isPromiseFs()` throws an exception when using `import * as fs from "node:fs"`. This should be tested with version 1.27.1.

---

## 2. Clone/Pull/Checkout Operations

### Clone with Shallow Depth

```typescript
await git.clone({
  fs,
  http,
  dir: '/path/to/repo',
  url: 'https://github.com/user/repo',
  singleBranch: true,    // Only fetch one branch
  depth: 1,              // Shallow clone (latest commit only)
  ref: 'main',           // Branch to clone (optional, defaults to default branch)
});
```

### Fetch Updates

```typescript
await git.fetch({
  fs,
  http,
  dir: '/path/to/repo',
  url: 'https://github.com/user/repo',
  ref: 'main',
  depth: 1,
  singleBranch: true,
  tags: false,
});
```

### Pull (Fetch + Merge)

```typescript
await git.pull({
  fs,
  http,
  dir: '/path/to/repo',
  ref: 'main',
  singleBranch: true,
  author: {
    name: 'Crude Functions',
    email: 'system@example.com'
  }
});
```

### Checkout Branch/Tag/Commit

```typescript
// Checkout branch
await git.checkout({
  fs,
  dir: '/path/to/repo',
  ref: 'main'
});

// Checkout specific tag
await git.checkout({
  fs,
  dir: '/path/to/repo',
  ref: 'v1.0.0'
});

// Checkout specific commit
await git.checkout({
  fs,
  dir: '/path/to/repo',
  ref: 'abc123def456'  // Commit SHA
});
```

### Resolve Reference to SHA

```typescript
// Get commit SHA from branch/tag name
const sha = await git.resolveRef({
  fs,
  dir: '/path/to/repo',
  ref: 'main'
});
console.log(sha);  // e.g., "abc123def456..."

// Read commit details
const commit = await git.readCommit({
  fs,
  dir: '/path/to/repo',
  oid: sha
});
```

---

## 3. HTTPS Auth Token Handling

### Method 1: onAuth Callback (Recommended)

```typescript
await git.clone({
  fs,
  http,
  dir: '/path/to/repo',
  url: 'https://github.com/user/private-repo',
  onAuth: (url) => {
    return {
      username: 'anything',  // GitHub ignores username for token auth
      password: 'ghp_xxxxxxxxxxxxxxxxxxxx'  // Personal Access Token
    };
  }
});
```

### Method 2: Embed in URL

```typescript
const repoUrl = "https://github.com/user/private-repo";
const u = new URL(repoUrl);
u.username = 'token';  // Or any non-empty string
u.password = 'ghp_xxxxxxxxxxxxxxxxxxxx';

await git.clone({
  fs,
  http,
  dir: '/path/to/repo',
  url: u.toString()  // https://token:ghp_xxx@github.com/user/private-repo
});
```

### Custom Headers Support

```typescript
const auth = {
  username: 'user',
  password: 'token',
  headers: {
    'X-Custom-Header': 'value'
  }
};
```

### Cancel Authentication

```typescript
onAuth: (url) => {
  if (!hasCredentials) {
    return { cancel: true };  // Abort operation
  }
  return { username, password };
}
```

---

## 4. Memory Usage for Large Repos

### Known Performance Issues

**Issue:** [Bad performance with huge pack and idx files #291](https://github.com/isomorphic-git/isomorphic-git/issues/291)

**Problem:** Original implementation loaded entire packfiles into memory and used `Array.includes()` for hash lookups.

**Impact with 50-100 MB packfiles:**
- Packed repository: ~20+ seconds for operations
- Unpacked repository: ~1.8 seconds (same data)
- **10-12x performance penalty**

**Resolution:** Community fixes using Map-based caching brought performance to near-filesystem levels (~1.9s).

### Mitigation Strategies

1. **Always use shallow clones:**
   ```typescript
   depth: 1,
   singleBranch: true
   ```

2. **Benefits of shallow clones:**
   - Reduced disk usage (no full history)
   - Faster clone operations (real-world: 29.5s vs 4m24s for large repos)
   - Lower memory footprint
   - Faster everyday operations (less history to process)

3. **Considerations:**
   - Shallow clones work well for CI/CD and read-only scenarios
   - Not ideal for development work (push operations slower)
   - Perfect for our use case (read-only sync)

---

## 5. HTTP Client

### Node.js Client

```typescript
import http from "npm:isomorphic-git@1.27.1/http/node";
```

### Browser Client (uses Fetch API)

```typescript
import http from 'isomorphic-git/http/web';
```

### Custom HTTP Client

```typescript
const customHttp = {
  async request({ url, method, headers, body, onProgress }) {
    // Custom implementation
    return {
      url,
      method,
      headers,
      body,         // AsyncIterableIterator<Uint8Array>
      statusCode,   // number
      statusMessage // string
    };
  }
};

await git.clone({ fs, http: customHttp, dir, url });
```

### Proxy Support

```typescript
import { request as delegate } from 'isomorphic-git/http/node';
import { HttpsProxyAgent } from 'hpagent';

const http = {
  async request({ url, method, headers, body }) {
    const agent = new HttpsProxyAgent({ proxy: process.env.https_proxy });
    return delegate({ url, method, agent, headers, body });
  }
};
```

---

## 6. Alternatives Considered

### simple-git-deno

- **Approach:** Shells out to native `git` binary
- **Pros:** Full git compatibility, well-maintained
- **Cons:** Requires git installed in container, not pure JS
- **Status:** Last commit December 2024
- **Link:** [chudnyi/simple-git-deno](https://github.com/chudnyi/simple-git-deno)

### iso-git

- **Approach:** Deno-specific wrapper around isomorphic-git
- **Pros:** Provides Deno shims for fs and http
- **Cons:** Last updated July 2021, likely outdated
- **Link:** [nest.land/iso-git](https://next-nest-test.vercel.app/x/iso-git)

### Recommendation

**Use isomorphic-git@1.27.1 directly** via Deno's npm: specifier. It's the most maintained option and provides all needed functionality without requiring external dependencies.

---

## 7. Implementation Recommendations

### Imports for Crude Functions

```typescript
import git from "npm:isomorphic-git@1.27.1";
import http from "npm:isomorphic-git@1.27.1/http/node";
import * as fs from "node:fs/promises";
```

### Sync Strategy

1. **Initial clone:** Full shallow clone with `depth: 1, singleBranch: true`
2. **Subsequent syncs:** Use `git.fetch()` + `git.checkout()` instead of `git.pull()`
3. **Rationale:** More control over conflict handling (we don't have local changes)

### Error Handling

```typescript
try {
  await git.clone({ ... });
} catch (error) {
  if (error.code === 'HttpError') {
    // Network/auth failure
  } else if (error.code === 'NotFoundError') {
    // Repo doesn't exist
  }
  // Log error, keep old files
}
```

### File System Access

For Deno, use `node:fs/promises`:

```typescript
import * as fs from "node:fs/promises";

// May need to wrap for compatibility
const gitFs = {
  promises: {
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    unlink: fs.unlink,
    readdir: fs.readdir,
    mkdir: fs.mkdir,
    rmdir: fs.rmdir,
    stat: fs.stat,
    lstat: fs.lstat,
    readlink: fs.readlink,
    symlink: fs.symlink,
    chmod: fs.chmod,
  }
};
```

---

## 8. Verification Checklist

Before implementation, verify:

- [ ] `npm:isomorphic-git@1.27.1` imports successfully in Deno
- [ ] Clone public repo works with Deno's `node:fs`
- [ ] Clone private repo with PAT works
- [ ] Checkout specific branch/tag/commit works
- [ ] Fetch + checkout workflow works for updates
- [ ] Memory usage acceptable with shallow clone of medium repo (~10MB)
- [ ] Error handling works (bad URL, bad credentials, network failure)

---

## Sources

- [isomorphic-git GitHub](https://github.com/isomorphic-git/isomorphic-git)
- [isomorphic-git Documentation](https://isomorphic-git.org/)
- [Deno Compatibility Issue #2004](https://github.com/isomorphic-git/isomorphic-git/issues/2004)
- [Performance Issue #291](https://github.com/isomorphic-git/isomorphic-git/issues/291)
- [iso-git on nest.land](https://next-nest-test.vercel.app/x/iso-git)
- [simple-git-deno](https://github.com/chudnyi/simple-git-deno)
- [Atlassian: Git Shallow Clone](https://www.atlassian.com/git/tutorials/big-repositories)
