# Base image can be overridden for hardened variant:
# docker build --build-arg BASE_IMAGE=dhi.io/deno:2 .
ARG BASE_IMAGE=denoland/deno:2.6.4
ARG BUILD_VERSION=dev
ARG SURREALDB_VERSION=v3.0.0-beta.2

# SurrealDB binary stage
FROM surrealdb/surrealdb:${SURREALDB_VERSION} AS surrealdb

# Builder stage - uses standard deno image for shell utilities
FROM denoland/deno:2.6.4 AS builder

WORKDIR /app

# Copy dependency files and cache dependencies
COPY deno.json deno.lock ./
RUN deno install

# Copy application source code (tests and docs excluded via .dockerignore)
COPY main.ts ./
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/

# Generate version file with build-time version
RUN echo "export const APP_VERSION = \"${BUILD_VERSION}\";" > src/version.ts

# Build vendor assets (CodeMirror bundle with SurrealQL support)
RUN deno task build:vendor

# Create directories for volumes
RUN mkdir -p /app/config /app/code

# Final stage - uses specified base image (standard or hardened)
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy SurrealDB binary from official image
# Runs as sidecar process managed by Deno
COPY --from=surrealdb --chown=deno:deno /surreal /surreal

# Copy everything from builder including Deno cache
# Note: /app includes built static/vendor/ assets from build:vendor task
COPY --from=builder --chown=deno:deno /deno-dir /deno-dir
COPY --from=builder --chown=deno:deno /app /app

# Default ports - override with FUNCTION_PORT and MANAGEMENT_PORT env vars
ENV FUNCTION_PORT=8000
ENV MANAGEMENT_PORT=9000

# SurrealDB configuration - internal port, not exposed
ENV SURREAL_PORT=5173
ENV SURREAL_STORAGE=./data/surreal
ENV SURREAL_BINARY=/surreal
ENV SURREAL_USER=root
ENV SURREAL_PASS=root

# Expose default ports (override with -p when running container)
# Note: SURREAL_PORT (5173) is internal only, not exposed
EXPOSE 8000 9000

# Run the application with necessary permissions
# --allow-run=/surreal restricts subprocess spawning to only the SurrealDB binary
ENTRYPOINT []
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "--allow-run=/surreal", "main.ts"]
