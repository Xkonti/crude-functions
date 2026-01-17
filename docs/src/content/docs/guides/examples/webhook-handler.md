---
title: "Example: Webhook Handler"
description: Processing webhooks with signature verification
---

This guide demonstrates how to build a production-ready webhook handler in Crude Functions using Stripe as an example. You'll learn signature verification, event handling, secure credential storage, and debugging techniques.

## What We'll Build

A Stripe webhook handler that:
- Verifies webhook signatures for security
- Handles multiple event types
- Uses secrets for API credentials
- Logs events for debugging and auditing
- Returns appropriate responses to Stripe

## Prerequisites

Before starting, make sure you have:
- Crude Functions running and configured
- A Stripe account (or test account)
- Basic understanding of webhooks
- Familiarity with [secrets management](/guides/secrets)

## Overview: How Webhooks Work

Webhooks are HTTP callbacks that external services (like Stripe) send to notify your application of events. When something happens (payment succeeded, subscription canceled, etc.), the service sends a POST request to your endpoint with event data.

**Security is critical:** Anyone can send POST requests to your webhook endpoint, so you must verify that requests genuinely come from the service provider using signature verification.

## Step 1: Create the Handler File

Create a file called `stripe-webhook.ts` in your `code/webhooks/` directory:

```typescript
// code/webhooks/stripe-webhook.ts
import Stripe from "npm:stripe@17.7.0";

export default async function (c, ctx) {
  // Get Stripe signature from headers
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    console.error(`[${ctx.requestId}] Missing stripe-signature header`);
    return c.json({ error: "Missing signature" }, 400);
  }

  // Load secrets for webhook verification and API access
  const [webhookSecret, apiKey] = await Promise.all([
    ctx.getSecret("STRIPE_WEBHOOK_SECRET"),
    ctx.getSecret("STRIPE_API_KEY"),
  ]);

  // Validate required secrets
  if (!webhookSecret || !apiKey) {
    console.error(`[${ctx.requestId}] Stripe secrets not configured`);
    return c.json({ error: "Configuration error" }, 500);
  }

  // Initialize Stripe client
  const stripe = new Stripe(apiKey, {
    apiVersion: "2024-09-30.acacia",
  });

  // Get raw request body (required for signature verification)
  const rawBody = await c.req.text();

  // Verify webhook signature
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error(`[${ctx.requestId}] Webhook signature verification failed:`, error);
    return c.json({ error: "Invalid signature" }, 400);
  }

  console.log(`[${ctx.requestId}] Received event: ${event.type} (${event.id})`);

  // Handle different event types
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentSuccess(event.data.object as Stripe.PaymentIntent, ctx.requestId);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentFailure(event.data.object as Stripe.PaymentIntent, ctx.requestId);
        break;

      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription, ctx.requestId);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, ctx.requestId);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionCanceled(event.data.object as Stripe.Subscription, ctx.requestId);
        break;

      default:
        console.log(`[${ctx.requestId}] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`[${ctx.requestId}] Error processing event ${event.id}:`, error);
    // Return 500 to tell Stripe to retry
    return c.json({ error: "Processing failed" }, 500);
  }

  // Return 200 to acknowledge receipt
  return c.json({ received: true });
}

// Event handlers

async function handlePaymentSuccess(
  payment: Stripe.PaymentIntent,
  requestId: string
): Promise<void> {
  console.log(`[${requestId}] Payment succeeded: ${payment.id}`);
  console.log(`[${requestId}]   Amount: ${payment.amount} ${payment.currency}`);
  console.log(`[${requestId}]   Customer: ${payment.customer}`);

  // TODO: Update order status in your database
  // TODO: Send confirmation email to customer
  // TODO: Trigger fulfillment process
}

async function handlePaymentFailure(
  payment: Stripe.PaymentIntent,
  requestId: string
): Promise<void> {
  console.error(`[${requestId}] Payment failed: ${payment.id}`);
  console.error(`[${requestId}]   Failure code: ${payment.last_payment_error?.code}`);
  console.error(`[${requestId}]   Failure message: ${payment.last_payment_error?.message}`);

  // TODO: Update order status to failed
  // TODO: Send payment failure notification
  // TODO: Log for manual review
}

async function handleSubscriptionCreated(
  subscription: Stripe.Subscription,
  requestId: string
): Promise<void> {
  console.log(`[${requestId}] Subscription created: ${subscription.id}`);
  console.log(`[${requestId}]   Customer: ${subscription.customer}`);
  console.log(`[${requestId}]   Status: ${subscription.status}`);

  // TODO: Create subscription record in database
  // TODO: Grant access to subscription features
  // TODO: Send welcome email
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  requestId: string
): Promise<void> {
  console.log(`[${requestId}] Subscription updated: ${subscription.id}`);
  console.log(`[${requestId}]   Status: ${subscription.status}`);

  // TODO: Update subscription status in database
  // TODO: Adjust feature access if needed
}

async function handleSubscriptionCanceled(
  subscription: Stripe.Subscription,
  requestId: string
): Promise<void> {
  console.log(`[${requestId}] Subscription canceled: ${subscription.id}`);
  console.log(`[${requestId}]   Canceled at: ${new Date(subscription.canceled_at! * 1000).toISOString()}`);

  // TODO: Revoke subscription access
  // TODO: Update database status
  // TODO: Send cancellation confirmation email
}
```

## Step 2: Store Stripe Credentials as Secrets

Your webhook needs two secrets: the webhook signing secret and your Stripe API key.

### Get your Stripe webhook secret

1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com/)
2. Go to **Developers** > **Webhooks**
3. Click **Add endpoint** or edit an existing endpoint
4. Set the endpoint URL to your function URL (e.g., `https://your-domain.com/run/webhooks/stripe`)
5. Select the events you want to receive (or select "all events" for testing)
6. After saving, click **Reveal** next to "Signing secret"
7. Copy the secret (starts with `whsec_`)

### Get your Stripe API key

1. In the Stripe Dashboard, go to **Developers** > **API keys**
2. Copy your **Secret key** (starts with `sk_test_` for test mode or `sk_live_` for production)

:::caution[Never hardcode secrets]
Never put your Stripe credentials directly in your code. Always use secrets management.
:::

### Add secrets via Web UI

1. Navigate to `http://localhost:8000/web/secrets`
2. Click **"Add Secret"**
3. Create the webhook secret:
   - **Name**: `STRIPE_WEBHOOK_SECRET`
   - **Value**: `whsec_...` (your webhook signing secret)
   - **Scope**: `Global` (or function-scoped if you prefer)
   - **Comment**: "Stripe webhook signing secret - rotate monthly"
4. Create the API key:
   - **Name**: `STRIPE_API_KEY`
   - **Value**: `sk_test_...` or `sk_live_...`
   - **Scope**: `Global`
   - **Comment**: "Stripe secret API key"

### Add secrets via API

Alternatively, use the management API:

```bash
# Create webhook secret
curl -X POST http://localhost:8000/api/secrets \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "STRIPE_WEBHOOK_SECRET",
    "value": "whsec_your_webhook_secret",
    "scope": "global",
    "comment": "Stripe webhook signing secret"
  }'

# Create API key secret
curl -X POST http://localhost:8000/api/secrets \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "STRIPE_API_KEY",
    "value": "sk_test_your_api_key",
    "scope": "global",
    "comment": "Stripe secret API key"
  }'
```

## Step 3: Register the Webhook Route

Create a function route for your webhook handler.

### Using the Web UI

1. Navigate to `http://localhost:8000/web/functions`
2. Click **"Add Function"**
3. Fill in the form:
   - **Name**: `stripe-webhook`
   - **Description**: "Stripe webhook handler with signature verification"
   - **Handler**: `webhooks/stripe-webhook.ts`
   - **Route**: `/webhooks/stripe`
   - **Methods**: `POST` (only POST)
   - **API Keys**: *(leave empty - Stripe uses signature verification, not API keys)*
4. Click **"Create"**

### Using the API

```bash
curl -X POST http://localhost:8000/api/functions \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "stripe-webhook",
    "description": "Stripe webhook handler",
    "handler": "webhooks/stripe-webhook.ts",
    "route": "/webhooks/stripe",
    "methods": ["POST"],
    "keys": []
  }'
```

:::tip[Why no API keys?]
Webhook endpoints typically don't use Crude Functions API keys because the external service (Stripe) uses its own signature verification mechanism. This is more secure than sharing an API key with a third-party service.
:::

## Step 4: Test Your Webhook

### Option A: Test with Stripe CLI (Recommended)

The [Stripe CLI](https://stripe.com/docs/stripe-cli) lets you forward webhook events from Stripe to your local server.

1. Install Stripe CLI:
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Linux (x64)
curl -L https://github.com/stripe/stripe-cli/releases/latest/download/stripe_linux_x86_64.tar.gz | tar xz
sudo mv stripe /usr/local/bin/

# Windows
# Download from https://github.com/stripe/stripe-cli/releases
```

2. Login to Stripe:
```bash
stripe login
```

3. Forward webhooks to your local endpoint:
```bash
stripe listen --forward-to http://localhost:8000/run/webhooks/stripe
```

This will output a webhook signing secret (starts with `whsec_`). Update your `STRIPE_WEBHOOK_SECRET` secret with this value.

4. In another terminal, trigger a test event:
```bash
# Trigger payment success
stripe trigger payment_intent.succeeded

# Trigger payment failure
stripe trigger payment_intent.payment_failed

# Trigger subscription created
stripe trigger customer.subscription.created
```

5. Check your function logs:
```bash
# View logs in the web UI
# http://localhost:8000/web/functions → click your function → Logs tab

# Or via API
curl -H "X-API-Key: your-management-key" \
  "http://localhost:8000/api/logs?functionId=<your-function-id>&limit=50"
```

### Option B: Test with curl

For quick testing, you can send test payloads manually (but signature verification will fail):

```bash
# Test missing signature
curl -X POST http://localhost:8000/run/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"type": "payment_intent.succeeded"}'

# Expected: {"error": "Missing signature"} with 400 status

# Test with dummy signature (will fail verification)
curl -X POST http://localhost:8000/run/webhooks/stripe \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=1234567890,v1=dummy" \
  -d '{"type": "payment_intent.succeeded"}'

# Expected: {"error": "Invalid signature"} with 400 status
```

For real signature testing, use the Stripe CLI as described above.

### Option C: Use Stripe Dashboard Test Mode

1. Make sure your webhook endpoint is publicly accessible (use ngrok or similar for local testing)
2. In Stripe Dashboard, add your public URL as a webhook endpoint
3. Send test events from the Stripe Dashboard
4. Monitor your function logs in the Crude Functions web UI

## Signature Verification Explained

Webhook signature verification is critical for security. Here's how it works:

### Why verify signatures?

Without verification, anyone could:
- Send fake payment success events to grant free access
- Spam your webhook with malicious payloads
- Trigger unintended business logic

### How Stripe signatures work

1. **Stripe generates signature**: For each webhook, Stripe creates an HMAC signature using your webhook secret
2. **Signature in headers**: The signature is sent in the `stripe-signature` header
3. **Your code verifies**: You reconstruct the signature using the same secret and compare
4. **Match = authentic**: If signatures match, the request genuinely came from Stripe

### Implementation details

```typescript
// This is what the Stripe library does internally:
const rawBody = await c.req.text();
const signature = c.req.header("stripe-signature");

// Stripe.webhooks.constructEvent verifies:
// 1. Signature format is valid
// 2. Timestamp is recent (prevents replay attacks)
// 3. HMAC signature matches the computed value
event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
```

### Common pitfalls

**Don't parse the body before verification:**

```typescript
// ❌ Bad: Body already parsed, signature verification will fail
const body = await c.req.json();
event = stripe.webhooks.constructEvent(JSON.stringify(body), signature, secret);

// ✅ Good: Use raw body for verification
const rawBody = await c.req.text();
event = stripe.webhooks.constructEvent(rawBody, signature, secret);
```

**Use the correct secret:**

```typescript
// ❌ Bad: Using API key instead of webhook secret
const event = stripe.webhooks.constructEvent(rawBody, signature, stripeApiKey);

// ✅ Good: Using webhook signing secret
const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
```

## Logging and Debugging

Effective logging is essential for debugging webhooks.

### What to log

```typescript
// Log every webhook received
console.log(`[${ctx.requestId}] Received event: ${event.type} (${event.id})`);

// Log event details
console.log(`[${ctx.requestId}] Payment succeeded: ${payment.id}`);
console.log(`[${ctx.requestId}]   Amount: ${payment.amount} ${payment.currency}`);
console.log(`[${ctx.requestId}]   Customer: ${payment.customer}`);

// Log errors with context
console.error(`[${ctx.requestId}] Error processing event ${event.id}:`, error);

// Log unhandled events (helps identify missing handlers)
console.log(`[${ctx.requestId}] Unhandled event type: ${event.type}`);
```

### Use request IDs

Always include `ctx.requestId` in logs to trace specific webhook events:

```typescript
console.log(`[${ctx.requestId}] Processing payment ${payment.id}`);
```

This makes it easy to search logs for a specific webhook when debugging.

### Viewing logs

**Web UI:**
1. Navigate to `http://localhost:8000/web/functions`
2. Click on your webhook function
3. Switch to the **Logs** tab
4. Filter by level (log, error, warn)
5. Search by request ID

**API:**
```bash
# Get recent logs
curl -H "X-API-Key: your-key" \
  "http://localhost:8000/api/logs?functionId=1&limit=100"

# Filter by error level
curl -H "X-API-Key: your-key" \
  "http://localhost:8000/api/logs?level=error&limit=50"
```

### Debugging tips

**1. Test signature verification first:**
```typescript
console.log(`[${ctx.requestId}] Verifying signature...`);
console.log(`[${ctx.requestId}] Signature header:`, signature?.substring(0, 50) + "...");
console.log(`[${ctx.requestId}] Body length:`, rawBody.length);
```

**2. Log full event data during development:**
```typescript
if (environment === "development") {
  console.log(`[${ctx.requestId}] Full event:`, JSON.stringify(event, null, 2));
}
```

**3. Track processing time:**
```typescript
const startTime = Date.now();
await handlePaymentSuccess(payment, ctx.requestId);
const duration = Date.now() - startTime;
console.log(`[${ctx.requestId}] Processed in ${duration}ms`);
```

## Error Handling Best Practices

### Return appropriate status codes

Stripe (and most webhook providers) retry failed webhooks based on HTTP status codes:

```typescript
try {
  // Process event
  await handleEvent(event);

  // 200 = Success, don't retry
  return c.json({ received: true });
} catch (error) {
  console.error(`[${ctx.requestId}] Processing failed:`, error);

  // 500 = Temporary failure, retry later
  return c.json({ error: "Processing failed" }, 500);
}
```

**Status code guide:**
- `200` - Success, event processed
- `400` - Bad request (invalid signature, malformed payload) - won't retry
- `500` - Server error, temporary failure - will retry

### Handle retries gracefully

Stripe will retry failed webhooks. Make your handlers idempotent:

```typescript
async function handlePaymentSuccess(payment: Stripe.PaymentIntent, requestId: string) {
  // Check if we already processed this payment
  const existing = await db.getPaymentByStripeId(payment.id);

  if (existing && existing.status === "completed") {
    console.log(`[${requestId}] Payment ${payment.id} already processed, skipping`);
    return; // Idempotent - safe to receive same event multiple times
  }

  // Process payment
  await db.updatePaymentStatus(payment.id, "completed");
  await sendConfirmationEmail(payment);
}
```

### Validate event data

Don't assume event data is complete or valid:

```typescript
async function handlePaymentSuccess(payment: Stripe.PaymentIntent, requestId: string) {
  // Validate required fields
  if (!payment.customer) {
    console.error(`[${requestId}] Payment ${payment.id} missing customer field`);
    return; // Skip processing
  }

  if (!payment.amount || payment.amount <= 0) {
    console.error(`[${requestId}] Payment ${payment.id} has invalid amount: ${payment.amount}`);
    return;
  }

  // Safely process
  await processPayment(payment);
}
```

## Advanced: Multi-tenant Webhooks

For multi-tenant applications, use key-scoped secrets to handle customer-specific webhooks:

```typescript
// Each customer has their own API key with key-scoped secrets:
// - STRIPE_WEBHOOK_SECRET (customer-specific webhook secret)
// - STRIPE_API_KEY (customer's Stripe account API key)
// - TENANT_ID (customer identifier)

export default async function (c, ctx) {
  // This requires the webhook to be called with an API key
  const tenantId = await ctx.getSecret("TENANT_ID");

  if (!tenantId) {
    return c.json({ error: "Tenant not configured" }, 403);
  }

  // Get tenant-specific secrets
  const [webhookSecret, apiKey] = await Promise.all([
    ctx.getSecret("STRIPE_WEBHOOK_SECRET"), // Key-scoped
    ctx.getSecret("STRIPE_API_KEY"),        // Key-scoped
  ]);

  console.log(`[${ctx.requestId}] Processing webhook for tenant: ${tenantId}`);

  // Verify signature with tenant's webhook secret
  const stripe = new Stripe(apiKey, { apiVersion: "2024-09-30.acacia" });
  const rawBody = await c.req.text();
  const signature = c.req.header("stripe-signature")!;

  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  // Process event for specific tenant
  await processEventForTenant(event, tenantId, ctx.requestId);

  return c.json({ received: true });
}
```

Configure route to require API key:
```json
{
  "name": "stripe-webhook-multitenant",
  "route": "/webhooks/stripe",
  "methods": ["POST"],
  "keys": [1]  // Requires API key from group 1
}
```

## Generic Webhook Handler

Here's a generic webhook handler pattern that works with any service (GitHub, Slack, etc.):

```typescript
// code/webhooks/generic.ts
export default async function (c, ctx) {
  const signature = c.req.header("X-Hub-Signature-256"); // GitHub format
  const rawBody = await c.req.text();

  // Get webhook secret
  const secret = await ctx.getSecret("WEBHOOK_SECRET");
  if (!secret) {
    return c.json({ error: "Webhook not configured" }, 500);
  }

  // Verify signature
  const expectedSignature = await generateHmacSignature(rawBody, secret);

  if (signature !== expectedSignature) {
    console.error(`[${ctx.requestId}] Invalid signature`);
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse payload
  const payload = JSON.parse(rawBody);
  const eventType = c.req.header("X-Event-Type") || payload.type;

  console.log(`[${ctx.requestId}] Received ${eventType} event`);

  // Process event
  await processEvent(eventType, payload, ctx.requestId);

  return c.json({ message: "Webhook processed" });
}

async function generateHmacSignature(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return `sha256=${hex}`;
}

async function processEvent(eventType: string, payload: any, requestId: string) {
  switch (eventType) {
    case "push":
      console.log(`[${requestId}] Push to ${payload.ref}`);
      break;
    case "pull_request":
      console.log(`[${requestId}] PR #${payload.number}: ${payload.action}`);
      break;
    default:
      console.log(`[${requestId}] Unhandled event: ${eventType}`);
  }
}
```

## Security Best Practices

### 1. Always verify signatures
Never process webhooks without signature verification. This is your primary security mechanism.

### 2. Use HTTPS in production
Webhook endpoints should only be accessible over HTTPS to prevent man-in-the-middle attacks.

### 3. Rotate webhook secrets regularly
Update your webhook secrets periodically (e.g., every 90 days):
1. Generate new secret in Stripe Dashboard
2. Update the secret in Crude Functions
3. Test with Stripe CLI
4. Remove old secret from Stripe

### 4. Rate limit webhook endpoints
If you receive too many webhooks, consider rate limiting:
```typescript
// Check rate limit before processing
const allowed = await checkRateLimit(ctx.requestId, 100); // 100 req/min
if (!allowed) {
  return c.json({ error: "Rate limit exceeded" }, 429);
}
```

### 5. Validate event timestamps
Prevent replay attacks by checking event timestamps:
```typescript
// Stripe events include a timestamp
const eventTimestamp = event.created * 1000; // Convert to milliseconds
const age = Date.now() - eventTimestamp;

if (age > 5 * 60 * 1000) { // 5 minutes
  console.warn(`[${ctx.requestId}] Event too old, possible replay attack`);
  return c.json({ error: "Event expired" }, 400);
}
```

### 6. Don't expose internal errors
Return generic error messages to webhook senders:
```typescript
// ❌ Bad: Exposes internal details
return c.json({ error: error.message }, 500);

// ✅ Good: Generic error
return c.json({ error: "Processing failed" }, 500);
// Log details internally
console.error(`[${ctx.requestId}] Internal error:`, error);
```

## Troubleshooting

### Signature verification fails

**Causes:**
- Using wrong webhook secret (API key vs webhook secret)
- Body was parsed before verification
- Webhook secret doesn't match Stripe Dashboard
- Using different Stripe account (test vs live mode)

**Solutions:**
- Use raw body: `await c.req.text()`
- Verify secret matches Stripe Dashboard
- Check you're using the correct mode (test/live)

### Events not received

**Causes:**
- Webhook endpoint not publicly accessible
- Firewall blocking Stripe IPs
- Incorrect URL in Stripe Dashboard

**Solutions:**
- Use ngrok for local testing: `ngrok http 8000`
- Check firewall rules
- Verify URL in Stripe Dashboard

### Duplicate event processing

**Causes:**
- Stripe retrying failed webhooks
- Handler not idempotent

**Solutions:**
- Make handlers idempotent (check if already processed)
- Return 200 even if already processed

## Related Topics

- [Secrets Management](/guides/secrets) - Storing API credentials securely
- [Your First Function](/guides/your-first-function) - Handler structure and context reference
- [Logs](/guides/logs) - Viewing and debugging function logs
- [API Keys](/guides/api-keys) - Managing API authentication
