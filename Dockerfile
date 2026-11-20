# Un solo contenedor sirve todo: el API (Express) y el front (carpeta public/, sin build).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY public ./public
# La base vive en /data (carpeta ./data del servidor). Corre como "node" (uid 1000), no root:
# en el VPS la carpeta data/ debe pertenecer a 1000:1000 (ver DESPLIEGUE.md).
RUN mkdir -p /data && chown node:node /data
USER node
ENV DB_PATH=/data/intercambio.db PORT=3000
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
