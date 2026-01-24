# Base image can be overridden for hardened variant:
# docker build --build-arg BASE_IMAGE=dhi.io/deno:2 .
ARG BASE_IMAGE=denoland/deno:2.6.4
ARG BUILD_VERSION=dev

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

# Generate version file with build-time version
RUN echo "export const APP_VERSION = \"${BUILD_VERSION}\";" > src/version.ts

# Create directories for volumes
RUN mkdir -p /app/config /app/code

# Final stage - uses specified base image (standard or hardened)
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy everything from builder including Deno cache
COPY --from=builder --chown=deno:deno /deno-dir /deno-dir
COPY --from=builder --chown=deno:deno /app /app

# Set environment variables
ENV FUNCTION_PORT=8000
ENV MANAGEMENT_PORT=9000

# Expose both ports
EXPOSE 8000 9000

# Run the application with necessary permissions
ENTRYPOINT []
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "main.ts"]
