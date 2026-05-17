FROM node:20-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including tsx for running TypeScript)
RUN npm install

# Copy source code
COPY . .

# Expose the default port
EXPOSE 7000

# Run the addon with tsx
CMD ["npx", "tsx", "src/index.ts"]