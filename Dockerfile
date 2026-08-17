# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    TRANSPORT=stdio \
    HTTP_HOST=127.0.0.1 \
    HTTP_PORT=3000 \
    LOG_LEVEL=info
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json* ./
COPY --from=build /app/dist ./dist
RUN npm ci --omit=dev && npm cache clean --force
USER node
EXPOSE 3000
ENTRYPOINT ["node", "dist/index.js"]