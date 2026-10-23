# M12: the API image. Build: docker build -t mezgeb-api .
# The container applies pending migrations, then starts the API (ops/start.sh).
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @mezgeb/shared build && pnpm --filter @mezgeb/api build

FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
COPY apps/api/assets apps/api/assets
COPY ops/start.sh /app/start.sh
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "/app/start.sh"]
