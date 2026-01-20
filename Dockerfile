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
# Stage 2: Git provider (for copying to hardened images)
# Using Alpine with git package - this provides a minimal git installation
# ==============================================================================
FROM alpine:3.20 AS git-provider

RUN apk add --no-cache git ca-certificates

# ==============================================================================
# Stage 3: Final runtime image (standard with apt-get)
# ==============================================================================
FROM ${BASE_IMAGE} AS runtime-standard

WORKDIR /app

# Install git for standard Debian-based deno image
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
USER deno

# Copy Deno cache and application
COPY --from=builder --chown=deno:deno /deno-dir /deno-dir
COPY --from=builder --chown=deno:deno /app /app

# Set environment variables
ENV PORT=8000

# Expose the application port
EXPOSE 8000

# Run the application with necessary permissions
ENTRYPOINT []
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "--allow-run=git", "main.ts"]

# ==============================================================================
# Stage 4: Final runtime image (hardened without package manager)
# For DHI or other hardened images, git must be provided separately
# Build with: docker build --target runtime-hardened --build-arg BASE_IMAGE=dhi.io/deno:2 .
# ==============================================================================
FROM ${BASE_IMAGE} AS runtime-hardened

WORKDIR /app

# Copy git and required libraries from Alpine
# Note: This provides a dynamically-linked git from Alpine/musl
COPY --from=git-provider /usr/bin/git /usr/bin/git
COPY --from=git-provider /usr/libexec/git-core /usr/libexec/git-core
COPY --from=git-provider /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# Copy musl libc and other required shared libraries from Alpine
COPY --from=git-provider /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1
COPY --from=git-provider /lib/libz.so.1 /lib/libz.so.1
COPY --from=git-provider /usr/lib/libpcre2-8.so.0 /usr/lib/libpcre2-8.so.0
COPY --from=git-provider /usr/lib/libcurl.so.4 /usr/lib/libcurl.so.4
COPY --from=git-provider /lib/libssl.so.3 /lib/libssl.so.3
COPY --from=git-provider /lib/libcrypto.so.3 /lib/libcrypto.so.3
COPY --from=git-provider /usr/lib/libnghttp2.so.14 /usr/lib/libnghttp2.so.14
COPY --from=git-provider /usr/lib/libidn2.so.0 /usr/lib/libidn2.so.0
COPY --from=git-provider /usr/lib/libunistring.so.5 /usr/lib/libunistring.so.5
COPY --from=git-provider /usr/lib/libbrotlidec.so.1 /usr/lib/libbrotlidec.so.1
COPY --from=git-provider /usr/lib/libbrotlicommon.so.1 /usr/lib/libbrotlicommon.so.1
COPY --from=git-provider /usr/lib/libpsl.so.5 /usr/lib/libpsl.so.5
COPY --from=git-provider /usr/lib/libcares.so.2 /usr/lib/libcares.so.2
COPY --from=git-provider /usr/lib/libzstd.so.1 /usr/lib/libzstd.so.1

# Copy Deno cache and application
COPY --from=builder /deno-dir /deno-dir
COPY --from=builder /app /app

# Set environment variables
ENV PORT=8000
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV LD_LIBRARY_PATH=/lib:/usr/lib

# Expose the application port
EXPOSE 8000

# Run the application with necessary permissions
ENTRYPOINT []
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "--allow-run=git", "main.ts"]

# ==============================================================================
# Default target is runtime-standard
# ==============================================================================
FROM runtime-standard
