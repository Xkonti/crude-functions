# Base image can be overridden for hardened variant:
# docker build --build-arg BASE_IMAGE=dhi.io/deno:2 .
ARG BASE_IMAGE=denoland/deno:2.6.4
FROM ${BASE_IMAGE}

# Set working directory
WORKDIR /app

# Copy dependency files first for better caching
COPY deno.json deno.lock ./

# Cache dependencies from import map
RUN deno install

# Copy application source code
COPY main.ts main_test.ts function_handler_design.md ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# Create directories for volumes
RUN mkdir -p /app/config /app/code

# Set environment variables
ENV PORT=8000

# Expose the application port
EXPOSE 8000

# Run the application with necessary permissions
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "main.ts"]
