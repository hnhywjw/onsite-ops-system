FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates iputils-ping openssh-client sshpass

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public
COPY pptx-template.json ./
COPY docker-entrypoint.sh ./

RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /app/data && chown -R node:node /app

USER node

VOLUME ["/app/data"]

EXPOSE 3000
EXPOSE 3443

ENTRYPOINT ["/app/docker-entrypoint.sh"]
