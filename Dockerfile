FROM node:22-bookworm-slim

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src

RUN mkdir -p /app/data && chown node:node /app/data

USER node

ENV CDP_DB_PATH=/app/data/cdp.sqlite
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "--no-warnings", "src/http.js"]
