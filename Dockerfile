# Production Dockerfile for Nexus Dashboard
# Note: Run `npm run build` locally before building this image
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm install --omit=dev --ignore-scripts

# Copy pre-built dist and server code
COPY dist ./dist
COPY server.ts ./
COPY server ./server
COPY tsconfig.json ./
COPY vite.config.ts ./

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the port
EXPOSE 3001

# Set production environment
ENV NODE_ENV=production

# Start the server
CMD ["node", "--loader", "tsx", "server.ts"]
