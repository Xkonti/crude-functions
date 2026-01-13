---
title: Getting Started
description: Crude Functions overview
---

# Crude Functions

Crude Functions is a minimal, self-hosted serverless function platform that runs in a single Docker container. Write TypeScript functions, deploy them as HTTP endpoints, manage everything through a web UI or API. That's it.

**Philosophy:** Simple, pragmatic, and designed for internal use. No complex deployment pipelines, no sandboxing theater, no scaling nonsense. You want to run some functions on your network? Done.

**Target use case:** Internal network services with low-to-moderate traffic. Think internal APIs, webhooks, automation scripts, or small tools for your team.

## Who Should Use This?

You should use Crude Functions if you:

- Want a simple way to deploy and manage serverless-style functions internally
- Trust the code you're running (no sandboxing - this is for internal use)
- Don't need massive scale or complex orchestration
- Want to avoid cloud vendor lock-in for internal tooling
- Value simplicity over enterprise features

You should NOT use this if you:

- Need to run untrusted code (no sandbox)
- Expect high traffic
- Want a production-ready public API platform
- Need multi-tenancy or advanced isolation

## Features

- **Minimal footprint:** Single Deno process, ~25MB RAM idle
- **Zero-downtime deploys:** Hot-reload functions without restarting the server
- **Simple function authoring:** Register a function by specifying handler file location
- **No build step:** Deno runs TypeScript directly
- **API-based deployment:** Programmatically add/update functions via HTTP
- Secrets management with multiple scopes to keep them out of your code.
- **Web UI:** Browser-based management interface
- **API key authentication:** Flexible key-based access control
- Encryption at rest for API keys and secrets
