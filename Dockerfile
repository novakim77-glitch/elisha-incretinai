FROM node:20-alpine

WORKDIR /app

# Copy local monorepo packages first (for the file: dep)
COPY packages/imem-core ./packages/imem-core

# Copy bot manifest, install
COPY apps/incretina-bot/package.json apps/incretina-bot/package-lock.json ./apps/incretina-bot/
WORKDIR /app/apps/incretina-bot
RUN npm install --omit=dev

# Copy bot source
COPY apps/incretina-bot/src ./src

# Entrypoint: materialize service account from env, then start
COPY apps/incretina-bot/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/sa.json

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/index.js"]
