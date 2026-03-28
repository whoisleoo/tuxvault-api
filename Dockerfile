FROM node:22-alpine

RUN apk add --no-cache \
    samba-client \
    openssh-client

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8080

CMD ["npx", "tsx", "watch", "server.ts"]
