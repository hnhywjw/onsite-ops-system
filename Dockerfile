FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public
COPY data ./data
COPY pptx-template.json ./

RUN mkdir -p /app/data && chown -R node:node /app

USER node

VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server.js"]
