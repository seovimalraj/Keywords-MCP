# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install ALL deps (including devDeps for tsc)
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
COPY api/ ./api/
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# OCI image labels
LABEL org.opencontainers.image.source="https://github.com/seovimalraj/Keywords-MCP"
LABEL org.opencontainers.image.url="https://github.com/seovimalraj/Keywords-MCP"
LABEL org.opencontainers.image.title="Keywords MCP"
LABEL org.opencontainers.image.description="MCP server for keyword research – Google, YouTube, Amazon, Pinterest, Wikipedia & Gemini AI"

# Non-root user for security
RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/src/http-server.js"]
