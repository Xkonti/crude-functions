# Base image can be overridden for hardened variant:
# docker build --build-arg BASE_IMAGE=dhi.io/deno:2 .
ARG BASE_IMAGE=denoland/deno:2.6.4
ARG BUILD_VERSION=dev

# ==============================================================================
# Stage 1: Build static git binary (for hardened image compatibility)
# ==============================================================================
FROM alpine:3.20 AS git-builder

# Install build dependencies
RUN apk add --no-cache \
    build-base \
    curl \
    zlib-dev \
    zlib-static \
    openssl-dev \
    openssl-libs-static \
    pcre2-dev \
    linux-headers

# Download and build git statically
ARG GIT_VERSION=2.47.1
RUN curl -fsSL "https://github.com/git/git/archive/refs/tags/v${GIT_VERSION}.tar.gz" \
    | tar xz -C /tmp \
    && cd /tmp/git-${GIT_VERSION} \
    && make prefix=/usr/local \
       CFLAGS="-static" \
       LDFLAGS="-static" \
       NO_GETTEXT=1 \
       NO_TCLTK=1 \
       NO_PERL=1 \
       NO_PYTHON=1 \
       NO_EXPAT=1 \
       -j$(nproc) \
    && make prefix=/usr/local install \
    && strip /usr/local/bin/git

# Verify static linking
RUN file /usr/local/bin/git | grep -q "statically linked" \
    || (echo "ERROR: git is not statically linked" && exit 1)

# ==============================================================================
# Stage 2: Build Deno application
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
# Stage 3: Final runtime image
# ==============================================================================
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy static git binary (works on all image types including hardened)
COPY --from=git-builder /usr/local/bin/git /usr/local/bin/git

# Copy ca-certificates for HTTPS (needed for git clone)
COPY --from=git-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# Copy Deno cache and application
COPY --from=builder --chown=deno:deno /deno-dir /deno-dir
COPY --from=builder --chown=deno:deno /app /app

# Set environment variables
ENV PORT=8000
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# Expose the application port
EXPOSE 8000

# Run the application with necessary permissions
ENTRYPOINT []
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "--allow-run=git", "main.ts"]
