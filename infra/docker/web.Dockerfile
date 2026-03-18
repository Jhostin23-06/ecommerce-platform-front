FROM node:22-alpine

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json

RUN npm ci

COPY . .

RUN npm run build:web

EXPOSE 3000

CMD ["npm", "run", "start:web"]
