FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY apps/api/package*.json ./
RUN npm ci --only=production

# Copy TypeScript config and source
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src

# Install dev dependencies for build
RUN npm install typescript ts-node @types/node --save-dev

# Build the application
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Start the application
CMD ["npm", "start"]