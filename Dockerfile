# Imagen de producción de qule.ar: un solo contenedor sirve el API, el chat en vivo y la web.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/brand/package.json packages/brand/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
# onnxruntime (para el modelo de fotos explícitas) trae binarios para todas las plataformas: quedan solo los de esta
RUN cd node_modules/onnxruntime-node/bin/napi-v6 && rm -rf darwin win32 \
 && find linux -mindepth 1 -maxdepth 1 ! -name "$(node -p process.arch)" -exec rm -rf {} +
COPY . .
# Modelo de NudeNet para las fotos explícitas (12 MB), verificado por hash. Ver apps/api/scripts/nudenet-model.mjs
RUN node apps/api/scripts/nudenet-model.mjs
# URL pública para og:url, canonical y og:image (ver --build-arg en docs/DEPLOY.md)
ARG APP_URL=https://qule.ar
ENV APP_URL=$APP_URL
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
