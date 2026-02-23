FROM node:22-slim

LABEL maintainer="QuantumClaw <hello@allin1.app>"
LABEL description="QuantumClaw — AI agent runtime with knowledge graph memory"

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Create workspace directories
RUN mkdir -p workspace/memory workspace/logs workspace/delivery-queue workspace/media

# Dashboard port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start
CMD ["node", "src/index.js"]
