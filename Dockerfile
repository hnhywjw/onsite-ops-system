FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates iputils-ping openssh-client sshpass

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public
COPY scripts ./scripts
COPY pptx-template.json ./
COPY docker-entrypoint.sh ./

RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /app/data && chown -R node:node /app

USER node

VOLUME ["/app/data"]

EXPOSE 3000
EXPOSE 3443

# 用 sh 显式调用，即使升级过程中丢失可执行位也能正常启动。
ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
