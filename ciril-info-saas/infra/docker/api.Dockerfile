# API + worker image (same code, different entrypoint).
# Build context: repository root (ciril-info-saas/).
# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json ./
COPY apps/api/prisma ./prisma
COPY apps/api/prisma.config.ts ./
RUN npm ci --ignore-scripts && npx prisma generate

FROM deps AS build
COPY apps/api/tsconfig*.json apps/api/nest-cli.json ./
COPY apps/api/src ./src
RUN npx prisma generate && npx nest build && npm prune --omit=dev --ignore-scripts

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
# Migrations ship with the image; `migrate` service runs them before the API starts.
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/prisma.config.ts ./prisma.config.ts
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
