FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json

RUN npm ci

COPY . .

RUN npm run build:api

EXPOSE 4000

CMD ["sh", "-c", "npm run migrate:api && npm run start:api"]
