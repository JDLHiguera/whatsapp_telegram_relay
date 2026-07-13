FROM node:20-bookworm-slim AS base

ENV NODE_ENV=production
WORKDIR /app

FROM base AS dependencies

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json api.tl patch-gramjs.js ./
RUN npm ci --include=dev

FROM dependencies AS build

COPY tsconfig.json ./
COPY src ./src
COPY README.md .
COPY .env.example .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json api.tl patch-gramjs.js ./
RUN npm ci --only=prod

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/auth_info /app/data

VOLUME ["/app/auth_info", "/app/data"]

CMD ["npm", "start"]