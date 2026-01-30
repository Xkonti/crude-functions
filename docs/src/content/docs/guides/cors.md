---
title: CORS Configuration
description: Configure Cross-Origin Resource Sharing for your functions
---

When calling your functions from a web browser on a different domain, you'll need to configure CORS (Cross-Origin Resource Sharing). This guide explains what CORS is, how to set it up, and common troubleshooting tips.

## What is CORS?

CORS is a browser security feature that blocks web pages from making requests to different domains. If your frontend is at `https://app.example.com` and your Crude Functions API is at `https://api.example.com`, the browser will block the request unless the server explicitly allows it.

**When you need CORS:**
- Frontend JavaScript calling your functions from a different domain
- Single-page apps (React, Vue, etc.) making API calls

**When you don't need CORS:**
- Server-side code (Node.js, Python, etc.)
- Command-line tools (curl, httpie)
- API testing tools (Postman, Insomnia)
- Same-origin requests (frontend and API on same domain)

## How CORS Works in Crude Functions

Each function can have its own CORS configuration. When enabled:

1. **Preflight requests** - The browser sends an OPTIONS request before the actual request. Crude Functions handles this automatically.
2. **CORS headers** - The server adds headers like `Access-Control-Allow-Origin` to responses, telling the browser the request is allowed.

You don't need to handle OPTIONS requests in your function code - Crude Functions intercepts them when CORS is configured.

## Configuration Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `origins` | `string[]` | Yes | Allowed origins. Use `["*"]` for any, or specific URLs like `["https://app.example.com"]` |
| `credentials` | `boolean` | No | Allow cookies and auth headers. Cannot be `true` when using `*` origin |
| `maxAge` | `number` | No | How long browsers cache preflight responses (seconds). Default: 86400 (24 hours) |
| `allowHeaders` | `string[]` | No | Extra headers the client can send (beyond standard ones) |
| `exposeHeaders` | `string[]` | No | Response headers the client can read (beyond standard ones) |

## Enabling CORS via Web UI

1. Go to the Functions page and edit your function (or create a new one)
2. In the **HTTP Methods** section, make sure **OPTIONS** is checked
3. The **CORS Configuration** fieldset appears when OPTIONS is selected
4. Check **Enable CORS**
5. Configure your origins:
   - Enter one origin per line
   - Use `*` to allow any origin (not recommended for production)
   - Use specific URLs like `https://app.example.com`
6. Optionally enable **Allow Credentials** if your frontend sends cookies
7. Click **Save**

## Enabling CORS via API

Include the `cors` object when creating or updating a function:

**Single origin:**

```bash
curl -X POST http://localhost:9000/api/functions \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api",
    "handler": "my-functions/api.ts",
    "route": "/api/data",
    "methods": ["GET", "POST", "OPTIONS"],
    "cors": {
      "origins": ["https://app.example.com"]
    }
  }'
```

**Multiple origins:**

```bash
curl -X POST http://localhost:9000/api/functions \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api",
    "handler": "my-functions/api.ts",
    "route": "/api/data",
    "methods": ["GET", "POST", "OPTIONS"],
    "cors": {
      "origins": [
        "https://app.example.com",
        "https://admin.example.com"
      ]
    }
  }'
```

**With credentials:**

```bash
curl -X POST http://localhost:9000/api/functions \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api",
    "handler": "my-functions/api.ts",
    "route": "/api/data",
    "methods": ["GET", "POST", "OPTIONS"],
    "cors": {
      "origins": ["https://app.example.com"],
      "credentials": true,
      "maxAge": 3600
    }
  }'
```

**Allow any origin (development only):**

```bash
curl -X POST http://localhost:9000/api/functions \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api",
    "handler": "my-functions/api.ts",
    "route": "/api/data",
    "methods": ["GET", "POST", "OPTIONS"],
    "cors": {
      "origins": ["*"]
    }
  }'
```

## Common Scenarios

### Local Development

Your frontend runs at `http://localhost:3000`, Crude Functions at `http://localhost:8000`:

```json
{
  "cors": {
    "origins": ["http://localhost:3000"]
  }
}
```

### Production with Single Frontend

```json
{
  "cors": {
    "origins": ["https://app.example.com"]
  }
}
```

### Multiple Frontends

```json
{
  "cors": {
    "origins": [
      "https://app.example.com",
      "https://admin.example.com",
      "https://mobile.example.com"
    ]
  }
}
```

### Frontend with Authentication

If your frontend sends cookies or `Authorization` headers:

```json
{
  "cors": {
    "origins": ["https://app.example.com"],
    "credentials": true
  }
}
```

### Custom Headers

If your frontend sends custom headers like `X-Request-ID` or needs to read custom response headers:

```json
{
  "cors": {
    "origins": ["https://app.example.com"],
    "allowHeaders": ["X-Request-ID", "X-Custom-Header"],
    "exposeHeaders": ["X-Response-Time"]
  }
}
```

## Testing CORS

### From the Browser Console

Open your browser's developer console and run:

```javascript
fetch('http://localhost:8000/run/your-function')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);
```

If CORS is configured correctly, you'll see the response. If not, you'll see an error like:

```
Access to fetch at 'http://localhost:8000/run/your-function' from origin
'http://localhost:3000' has been blocked by CORS policy
```

### Simple HTML Test Page

Create an HTML file and open it in your browser:

```html
<!DOCTYPE html>
<html>
<body>
  <button onclick="testCORS()">Test CORS</button>
  <pre id="result"></pre>

  <script>
    async function testCORS() {
      try {
        const response = await fetch('http://localhost:8000/run/hello');
        const data = await response.json();
        document.getElementById('result').textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        document.getElementById('result').textContent = 'Error: ' + error.message;
      }
    }
  </script>
</body>
</html>
```

### Check Preflight Response

Use curl to see what CORS headers are returned:

```bash
curl -i -X OPTIONS http://localhost:8000/run/your-function \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET"
```

You should see headers like:

```
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Max-Age: 86400
```

## Security Considerations

- **Avoid `*` in production** - Wildcard allows any website to call your API. Use specific origins.
- **`credentials: true` requires specific origins** - You cannot use `*` with credentials enabled. This is enforced by browsers and Crude Functions validates this.
- **CORS is not authentication** - CORS only controls which websites can make requests. Use API keys to control who can access your functions.
- **Preflight caching** - The `maxAge` setting controls how long browsers cache preflight responses. Higher values reduce preflight requests but take longer to reflect CORS changes.

## Troubleshooting

### "No 'Access-Control-Allow-Origin' header"

**Cause:** CORS is not enabled for the function.

**Fix:** Edit the function, check OPTIONS in methods, enable CORS, and configure origins.

### "CORS credentials cannot be enabled when using wildcard (*) origin"

**Cause:** You tried to set `credentials: true` with `origins: ["*"]`.

**Fix:** Use specific origin URLs instead of `*` when credentials are needed.

### "The value of the 'Access-Control-Allow-Origin' header must not be the wildcard"

**Cause:** Your frontend is sending credentials but the server has `*` as the origin.

**Fix:** Change the CORS configuration to use the specific origin of your frontend.

### OPTIONS returns 404

**Cause:** The OPTIONS method is not selected for the function.

**Fix:** Edit the function and check the OPTIONS checkbox in the methods section.

### Preflight succeeds but actual request fails

**Cause:** This is usually not a CORS issue. Check:
- API key authentication (if required)
- Request body format
- Function errors (check logs)

### Changes not taking effect

**Cause:** Browser has cached the preflight response.

**Fix:** Either wait for the cache to expire (based on `maxAge`), or clear browser cache, or test in incognito mode.
