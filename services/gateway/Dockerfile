# Stage 1 compiles TypeScript. Stage 2 keeps only production deps, the compiled output and the SQL migrations.
FROM node:24.20.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.20.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# db.ts reads ../migrations/ relative to dist/, so they must sit next to it.
COPY migrations ./migrations
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
