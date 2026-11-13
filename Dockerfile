FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg python3 ca-certificates curl && rm -rf /var/lib/apt/lists/*
# yt-dlp do bot de música: a versão "standalone" (yt-dlp_linux) já traz o script EJS que resolve o desafio em
# JavaScript do YouTube (com o Node desta imagem). A versão comum (zipapp) não traz e o YouTube responde 403.
# YTDLP_BUST muda a cada deploy (deploy/umbrel.sh) para baixar o yt-dlp mais novo — o YouTube muda com frequência.
ARG TARGETARCH
ARG YTDLP_BUST=0
RUN echo "yt-dlp $YTDLP_BUST" && case "$TARGETARCH" in arm64) F=yt-dlp_linux_aarch64 ;; amd64|"") F=yt-dlp_linux ;; *) F=yt-dlp ;; esac \
  && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$F" -o /usr/local/bin/yt-dlp && chmod 755 /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts/reset-password.mjs ./scripts/reset-password.mjs
ENV DATA_DIR=/data PORT=3000 HTTPS_PORT=3443
VOLUME /data
# 40000 = mídia do SFU de voz (UDP e TCP; com SFU_WORKERS=N, também 40011..40010+N-1); 40001-40010 = transmissão nativa (UDP); defina RTC_ANNOUNCED_IP=<ip da VPN do host>
EXPOSE 3000 3443 40000/udp 40000/tcp 40001-40010/udp
# "unhealthy" no docker ps / painel da VPS quando o servidor para de responder ou a voz (SFU) está fora (server/health.js)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.js"]
