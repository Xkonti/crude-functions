# Base image can be overridden for hardened variant:
# docker build --build-arg BASE_IMAGE=dhi.io/deno:2 .
ARG BASE_IMAGE=denoland/deno:2.6.4

# Builder stage - uses standard deno image for shell utilities
FROM denoland/deno:2.6.4 AS builder

WORKDIR /app

# Copy dependency files and cache dependencies
COPY deno.json deno.lock ./
RUN deno install

# Copy application source code
# TODO: Make sure to exclude tests
# TODO: Make sure to exclude docs
COPY main.ts ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# Create directories for volumes
RUN mkdir -p /app/config /app/code

# Final stage - uses specified base image (standard or hardened)
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy everything from builder including Deno cache
COPY --from=builder --chown=deno:deno /deno-dir /deno-dir
COPY --from=builder --chown=deno:deno /app /app

# Set environment variables
ENV PORT=8000

# Expose the application port
EXPOSE 8000

# Run the application with necessary permissions
ENTRYPOINT []
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "main.ts"]
