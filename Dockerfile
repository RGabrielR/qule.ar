# Imagen de producción de qule.ar: un solo contenedor sirve el API, el chat en vivo y la web.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/brand/package.json packages/brand/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build --workspace web

FROM node:24-bookworm-slim
# ffmpeg (el paquete oficial de Debian) procesa los videos del álbum: los corta, los achica y les borra los metadatos
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
# Paquetes compartidos que usa el API
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/dist ./apps/web/dist
# Corre sin privilegios de root
RUN mkdir -p /data && chown -R node:node /data
USER node
WORKDIR /app/apps/api
VOLUME ["/data"]
EXPOSE 3001
CMD ["node", "--import", "tsx", "src/index.ts"]
