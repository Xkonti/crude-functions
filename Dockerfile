# Base image can be overridden for hardened variant:
# docker build --build-arg BASE_IMAGE=dhi.io/deno:2 .
ARG BASE_IMAGE=denoland/deno:2.6.4
ARG BUILD_VERSION=dev

# ==============================================================================
# Stage 1: Build Deno application
# ==============================================================================
FROM denoland/deno:2.6.4 AS builder

WORKDIR /app

# Copy dependency files and cache dependencies
COPY deno.json deno.lock ./
RUN deno install

# Copy application source code (tests and docs excluded via .dockerignore)
COPY main.ts ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# Generate version file with build-time version
ARG BUILD_VERSION=dev
RUN echo "export const APP_VERSION = \"${BUILD_VERSION}\";" > src/version.ts

# Create directories for volumes
RUN mkdir -p /app/config /app/code

# ==============================================================================
# Stage 2: Final runtime image
# ==============================================================================
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy Deno cache and application
COPY --from=builder --chown=deno:deno /deno-dir /deno-dir
COPY --from=builder --chown=deno:deno /app /app

# Set environment variables
ENV PORT=8000

# Expose the application port
EXPOSE 8000

# Run the application with necessary permissions
# Note: No --allow-run needed - git operations use isomorphic-git (pure JS)
ENTRYPOINT []
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "main.ts"]
