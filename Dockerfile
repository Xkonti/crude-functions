# Use official Deno image
FROM denoland/deno:2.1.4

# Set working directory
WORKDIR /app

# Copy dependency files first for better caching
COPY deno.json deno.lock ./

# Cache dependencies
RUN deno install --entrypoint main.ts

# Copy application source code
COPY main.ts main_test.ts function_handler_design.md ./
COPY src/ ./src/

# Create directories for volumes
RUN mkdir -p /app/config /app/code

# Set environment variables
ENV PORT=8000

# Expose the application port
EXPOSE 8000

# Run the application with necessary permissions
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "main.ts"]
