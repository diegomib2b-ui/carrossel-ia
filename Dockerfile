# deep cut — imagem de produção (Railway)
# Node + FFmpeg (vídeo) + Chromium (slides) + fontes da marca
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg chromium fonts-inter fonts-jetbrains-mono fonts-noto-color-emoji fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    PORT=3400

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3400
CMD ["node", "server.js"]
