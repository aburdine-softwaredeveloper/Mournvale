# Dockerfile — Mournvale game server (serves the built client + WebSocket).
#
# Saves are NOT baked into the image; they live in a host-mounted volume
# (see docker-compose.yml), so rebuilding/updating the image never touches them.

FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching. devDeps are kept because the server runs
# via tsx and the client is built with vite (both devDependencies).
COPY package.json package-lock.json ./
RUN npm ci

# App source, then build the client bundle into dist/client.
COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000

# Runs `tsx src/server/index.ts`, serving dist/client on $PORT.
CMD ["npm", "start"]
