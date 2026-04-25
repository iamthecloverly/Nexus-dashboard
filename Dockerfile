# Production Dockerfile for Nexus Dashboard
# Note: Run `npm run build` locally before building this image
#
# Use Debian-based image so esbuild can use its linux-x64 binary.
FROM node:20-bookworm-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies.
# NOTE: do NOT pass --ignore-scripts here. esbuild installs its platform binary
# via a postinstall script; skipping scripts breaks tsx/vite transforms at runtime.
RUN npm ci --omit=dev

# Copy pre-built dist and server code
COPY dist ./dist
COPY server.ts ./
COPY server ./server
COPY tsconfig.json ./
COPY vite.config.ts ./

# Create a non-root user for security (Debian)
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g 1001 -m -s /usr/sbin/nologin nodejs && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the port
EXPOSE 3001

# Set production environment
ENV NODE_ENV=production

# Start the server (Node 20+ requires --import for tsx)
CMD ["node", "--import", "tsx", "server.ts"]
