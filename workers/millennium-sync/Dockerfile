# Contexto de build = raiz do repositório (o worker importa src/data/wedash e src/lib).
FROM node:22-bookworm-slim

WORKDIR /app

COPY workers/millennium-sync/package.json workers/millennium-sync/package-lock.json ./workers/millennium-sync/

WORKDIR /app/workers/millennium-sync
RUN npm ci

WORKDIR /app
COPY workers/millennium-sync ./workers/millennium-sync
COPY src/data/wedash ./src/data/wedash
COPY src/lib ./src/lib

WORKDIR /app/workers/millennium-sync
ENV NODE_ENV=production
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
