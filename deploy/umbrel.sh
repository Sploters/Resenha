#!/bin/sh
# Envia o código para o Umbrel, reconstrói a imagem e recria o container com os mesmos dados.
# Uso: sh deploy/umbrel.sh [usuario@host] [ip-da-vpn]
# Requer chave SSH no servidor e o usuário no grupo docker.
# Com gente em chamada, a troca do container espera a sala esvaziar (reiniciar derruba todo mundo por ~6 s).
#   FORCAR=1 sh deploy/umbrel.sh   troca na hora mesmo com gente em chamada
#   ESPERA_MAX=30 ...              desiste depois de 30 min esperando (padrão 120); a imagem nova fica pronta
set -e
# O endereço do servidor não fica no repositório: passe como argumento ou crie deploy/servidor.conf
# (ignorado pelo git) com a linha: SERVIDOR=usuario@ip-da-vpn
[ -f "$(dirname "$0")/servidor.conf" ] && . "$(dirname "$0")/servidor.conf"
TARGET=${1:-$SERVIDOR}
[ -n "$TARGET" ] || { echo "Informe o servidor: sh $0 usuario@ip-da-vpn  (ou crie deploy/servidor.conf com SERVIDOR=usuario@ip)"; exit 1; }
IP=${2:-${TARGET#*@}}
FORCAR=${FORCAR:-0}; ESPERA_MAX=${ESPERA_MAX:-120}
cd "$(dirname "$0")/.."
tar czf - Dockerfile README.md PRIVACIDADE.md SECURITY.md package.json package-lock.json .gitignore deploy public server scripts | ssh "$TARGET" "
  set -e
  # troca de nome (LocalCord -> Resenha), só na primeira vez: para o container antigo e renomeia as pastas.
  # O banco localcord.db vira resenha.db sozinho quando o servidor novo abre.
  if [ -d ~/localcord-data ] && [ ! -e ~/resenha-data ]; then
    docker rm -f localcord >/dev/null 2>&1 || true
    mv ~/localcord-data ~/resenha-data
    echo 'pasta de dados renomeada: ~/localcord-data -> ~/resenha-data'
  fi
  if [ -d ~/localcord-backups ] && [ ! -e ~/resenha-backups ]; then mv ~/localcord-backups ~/resenha-backups; fi
  docker rm -f localcord >/dev/null 2>&1 || true
  rm -rf ~/localcord
  mkdir -p ~/resenha ~/resenha-backups ~/resenha-data
  # limpa o código antigo para não sobrar arquivo removido/renomeado (os dados ficam em ~/resenha-data)
  cd ~/resenha && rm -rf deploy public server scripts && tar xzf -
  docker build -q --build-arg YTDLP_BUST=\$(date +%Y%m%d) -t resenha . >/dev/null # yt-dlp novo a cada dia de deploy (o YouTube muda)
  # backup do banco antes de trocar o container
  DB=\$(cd ~/resenha-data && ls resenha.db* localcord.db* 2>/dev/null || true)
  [ -n \"\$DB\" ] && tar czf ~/resenha-backups/data-\$(date +%Y%m%d-%H%M%S).tgz -C ~/resenha-data \$DB
  # cookies do YouTube (opcional): coloque ~/resenha-data/cookies.txt no servidor
  COOKIES=; [ -f \$HOME/resenha-data/cookies.txt ] && COOKIES='-e YTDLP_COOKIES=/data/cookies.txt'
  # espera ninguém estar em chamada. O servidor grava ~/resenha-data/em-chamada.json a cada 10 s (só contagens);
  # arquivo velho (servidor antigo ou parado) = não sabe, segue. A imagem nova já está montada: a troca leva segundos.
  if [ \"$FORCAR\" != 1 ]; then
    F=\$HOME/resenha-data/em-chamada.json; INICIO=\$(date +%s); AVISOU=0
    while :; do
      [ -f \"\$F\" ] || break
      T=\$(sed -n 's/.*\"t\":\([0-9]*\).*/\1/p' \"\$F\"); N=\$(sed -n 's/.*\"inCalls\":\([0-9]*\).*/\1/p' \"\$F\")
      AGORA=\$(date +%s); [ -n \"\$T\" ] && [ \$((AGORA - T / 1000)) -lt 60 ] || break
      [ \"\${N:-0}\" -gt 0 ] || break
      if [ \$((AGORA - INICIO)) -ge \$(($ESPERA_MAX * 60)) ]; then
        echo \"Ainda há \$N pessoa(s) em chamada depois de $ESPERA_MAX min. Nada foi trocado; rode de novo depois (ou FORCAR=1).\"; exit 3
      fi
      if [ \$AVISOU = 0 ] || [ \$(( (AGORA - INICIO) % 300 )) -lt 15 ]; then
        echo \"\$N pessoa(s) em chamada agora. Esperando a chamada acabar para atualizar (Ctrl+C cancela; FORCAR=1 troca na hora)…\"; AVISOU=1
      fi
      sleep 15
    done
  fi
  # docker stop (não rm -f, que mata na hora): o servidor avisa os apps que está atualizando antes de fechar
  docker stop -t 8 resenha >/dev/null 2>&1 || true
  docker rm -f resenha >/dev/null 2>&1 || true
  docker run -d --name resenha --restart=always \\
    -p 3000:3000 -p 3443:3443 -p 40000:40000/udp -p 40000:40000/tcp -p 40001-40010:40001-40010/udp \\
    -v \$HOME/resenha-data:/data -e TLS_SAN=IP:$IP -e RTC_ANNOUNCED_IP=$IP \$COOKIES resenha >/dev/null
  sleep 4
  docker logs resenha 2>&1 | head -3
"
