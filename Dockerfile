FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy source code
COPY . .

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Build the application
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/healthz || exit 1

# Start the application
CMD ["npm", "run", "start:prod"]