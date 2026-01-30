---
title: Getting Started
description: Get Crude Functions running in minutes
---

This guide walks you through deploying Crude Functions and creating your first serverless endpoint. By the end, you'll have a working function responding to HTTP requests.

## Prerequisites

- **Docker** installed on your machine
- A **server or local machine** to host the container
- Basic **TypeScript** familiarity (helpful but not required)

## Quick Start

### 1. Deploy

Run the Docker container and configure your base URL.

**What you'll do:** Pull the image, set environment variables, and start the container. Takes about 2 minutes.

[Go to Deployment](./deployment)

### 2. First-Time Setup

Create your admin account and generate an API key.

**What you'll do:** Access the web UI, create the first user, and set up API access for managing functions programmatically.

[Go to First-Time Setup](./first-time-setup)

### 3. Your First Function

Write a handler, register a route, and test it.

**What you'll do:** Create a TypeScript function, register it as an HTTP endpoint, and call it. Covers the basics of parameters, POST requests, and logging.

[Go to Your First Function](./your-first-function)

## What's Next

Once you have a function running, explore these topics:

- [Code Sources](./code-sources) - Organize your code and sync from Git repositories
- [API Keys](./api-keys) - Protect your functions with key-based authentication
- [Secrets](./secrets) - Manage sensitive configuration securely
- [CORS](./cors) - Enable cross-origin requests from browsers
- [Logs](./logs) - Monitor function execution and debug issues
- [Metrics](./metrics) - Track performance and execution counts
