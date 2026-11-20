#!/bin/sh
# Lado do servidor do deploy (chamado por deploy/umbrel.sh depois de copiar o código para ~/resenha).
# Uso: sh servidor.sh instalar <ip> <forcar 0|1>      (monta a imagem e atualiza)
#      sh servidor.sh esperar  <ip> <hash>            (espera em segundo plano; quem chama é o próprio "instalar")
#
# Como o Discord: ninguém precisa sair da chamada para atualizar.
# 1. Só a interface mudou (public/): troca os arquivos dentro do container e manda SIGHUP. O servidor NÃO reinicia,
#    ninguém cai; as páginas recebem a versão nova e recarregam quando não atrapalha (public/uiupdate.js).
# 2. O servidor mudou: precisa reiniciar (as chamadas caem por ~6 s e voltam sozinhas). Troca na hora se não houver
#    chamada ATIVA (2+ pessoas conversando ou transmitindo; ver callActive em server/index.js). Pessoa sozinha ou gente
#    dormindo em silêncio na call não segura a atualização. Com chamada ativa: fica esperando em segundo plano (pode
#    fechar o terminal) e troca quando a conversa parar.
# 3. Limite: pendente há mais de ESPERA_HORAS (24), troca de madrugada (3 h às 6 h, fuso FUSO) mesmo com chamada ativa.
# FORCAR=1 troca na hora, sempre.
# Estado em ~/.resenha-deploy: rodando (hash do código do servidor que está no ar), pendente (desde quando espera),
# espera.pid (o processo que espera) e espera.log.
set -e
MODO=$1; IP=$2
EST=$HOME/.resenha-deploy; mkdir -p "$EST"
F=$HOME/resenha-data/em-chamada.json
ESPERA_HORAS=${ESPERA_HORAS:-24}; FUSO=${FUSO:-America/Sao_Paulo}

# hash de tudo que entra na imagem e não é public/ (mudou = precisa reiniciar o servidor)
hash_servidor() {
  cd "$HOME/resenha" && find server package.json package-lock.json Dockerfile PRIVACIDADE.md SECURITY.md scripts/reset-password.mjs -type f 2>/dev/null \
    | LC_ALL=C sort | xargs sha1sum | sha1sum | cut -c1-40
}
# pessoas em chamadas ativas agora. O servidor grava em-chamada.json a cada 10 s; arquivo velho (servidor parado) = 0.
# Servidor antigo (sem "emAtivas"): conta todo mundo em chamada, como antes.
em_ativas() {
  [ -f "$F" ] || { echo 0; return; }
  T=$(sed -n 's/.*"t":\([0-9]*\).*/\1/p' "$F")
  { [ -n "$T" ] && [ $(( $(date +%s) - T / 1000 )) -lt 60 ]; } || { echo 0; return; }
  N=$(sed -n 's/.*"emAtivas":\([0-9]*\).*/\1/p' "$F"); [ -n "$N" ] || N=$(sed -n 's/.*"inCalls":\([0-9]*\).*/\1/p' "$F")
  echo "${N:-0}"
}
madrugada() { H=$(TZ=$FUSO date +%H); [ "$H" = 03 ] || [ "$H" = 04 ] || [ "$H" = 05 ]; }
# a espera roda com setsid (líder do próprio grupo): mata o grupo inteiro, senão o sleep em andamento a deixaria viva
parar_espera() {
  if [ -f "$EST/espera.pid" ]; then P=$(cat "$EST/espera.pid"); kill -- "-$P" 2>/dev/null || kill "$P" 2>/dev/null || true; fi
  rm -f "$EST/espera.pid"
}

trocar_container() { # $1 = hash do código que vai entrar
  DB=$(cd "$HOME/resenha-data" && ls resenha.db* localcord.db* 2>/dev/null || true)
  [ -n "$DB" ] && tar czf "$HOME/resenha-backups/data-$(date +%Y%m%d-%H%M%S).tgz" -C "$HOME/resenha-data" $DB
  # cookies do YouTube (opcional): ~/resenha-data/cookies.txt. Chave da Steam (opcional): ~/resenha-steam.env com a
  # linha STEAM_API_KEY=suachave (fora do repositório e da pasta de dados; crie em steamcommunity.com/dev/apikey)
  COOKIES=; [ -f "$HOME/resenha-data/cookies.txt" ] && COOKIES='-e YTDLP_COOKIES=/data/cookies.txt'
  STEAM=; [ -f "$HOME/resenha-steam.env" ] && STEAM="--env-file $HOME/resenha-steam.env"
  # docker stop (não rm -f, que mata na hora): o servidor avisa os apps que está atualizando antes de fechar
  docker stop -t 8 resenha >/dev/null 2>&1 || true
  docker rm -f resenha >/dev/null 2>&1 || true
  docker run -d --name resenha --restart=always \
    -p 3000:3000 -p 3443:3443 -p 40000:40000/udp -p 40000:40000/tcp -p 40001-40010:40001-40010/udp \
    -v "$HOME/resenha-data:/data" -e TLS_SAN=IP:$IP -e RTC_ANNOUNCED_IP=$IP $COOKIES $STEAM resenha >/dev/null
  echo "$1" > "$EST/rodando"; rm -f "$EST/pendente"
  sleep 4
  docker logs resenha 2>&1 | head -3
}

case "$MODO" in
instalar)
  FORCAR=${3:-0}
  cd "$HOME/resenha"
  docker build -q --build-arg YTDLP_BUST=$(date +%Y%m%d) -t resenha . >/dev/null # yt-dlp novo a cada dia de deploy (o YouTube muda)
  SRV=$(hash_servidor)
  RODANDO=$(cat "$EST/rodando" 2>/dev/null || true)
  ATIVO=$(docker inspect -f '{{.State.Running}}' resenha 2>/dev/null || echo false)
  parar_espera # deploy novo substitui qualquer espera anterior

  # 1. só a interface mudou: troca sem reiniciar
  if [ "$FORCAR" != 1 ] && [ "$ATIVO" = true ] && [ -n "$RODANDO" ] && [ "$SRV" = "$RODANDO" ]; then
    rm -f "$EST/pendente"
    docker cp "$HOME/resenha/public" resenha:/app/public.new
    docker exec resenha sh -c 'rm -rf /app/public.old && mv /app/public /app/public.old && mv /app/public.new /app/public && rm -rf /app/public.old'
    docker kill -s HUP resenha >/dev/null
    sleep 2
    docker logs --since 15s resenha 2>&1 | grep -E 'Interface|SIGHUP' || true
    echo "Só a interface mudou: atualizada sem reiniciar (ninguém caiu da chamada). Cada página recarrega quando não atrapalhar."
    exit 0
  fi

  # 2. o servidor mudou (ou primeira vez com este deploy): reinicia agora se puder, senão espera em segundo plano
  N=$(em_ativas)
  if [ "$FORCAR" = 1 ] || [ "$ATIVO" != true ] || [ "$N" -eq 0 ]; then
    [ "$FORCAR" = 1 ] && [ "$N" -gt 0 ] && echo "FORCAR=1: trocando com $N pessoa(s) em chamada ativa (voltam sozinhas em segundos)."
    trocar_container "$SRV"
    exit 0
  fi
  [ -f "$EST/pendente" ] || date +%s > "$EST/pendente"
  cp "$HOME/resenha/deploy/servidor.sh" "$EST/servidor.sh" # cópia: um deploy novo pode trocar o arquivo original
  setsid nohup sh "$EST/servidor.sh" esperar "$IP" "$SRV" >> "$EST/espera.log" 2>&1 < /dev/null &
  echo $! > "$EST/espera.pid"
  echo "$N pessoa(s) em chamada com conversa acontecendo. A imagem nova está pronta e entra sozinha quando a conversa"
  echo "parar (gente sozinha ou em silêncio não conta). Pendente há mais de ${ESPERA_HORAS} h: entra de madrugada mesmo assim."
  echo "Pode fechar o terminal. Acompanhar: ssh no servidor e tail -f ~/.resenha-deploy/espera.log  |  Trocar já: FORCAR=1"
  ;;
esperar)
  SRV=$3
  echo "$(date '+%F %T') esperando as chamadas ativas acabarem para atualizar o servidor ($SRV)"
  AVISO=0
  while :; do
    N=$(em_ativas); DESDE=$(cat "$EST/pendente" 2>/dev/null || date +%s)
    if [ "$N" -eq 0 ]; then echo "$(date '+%F %T') nenhuma chamada ativa: atualizando"; trocar_container "$SRV"; break; fi
    if [ $(( $(date +%s) - DESDE )) -ge $(( ESPERA_HORAS * 3600 )) ] && madrugada; then
      echo "$(date '+%F %T') pendente há mais de ${ESPERA_HORAS} h: atualizando de madrugada com $N pessoa(s) em chamada ativa"
      trocar_container "$SRV"; break
    fi
    [ $(( $(date +%s) - AVISO )) -ge 1800 ] && { echo "$(date '+%F %T') $N pessoa(s) em chamada ativa; esperando"; AVISO=$(date +%s); }
    sleep 15
  done
  rm -f "$EST/espera.pid"
  ;;
*) echo "uso: $0 instalar <ip> [forcar] | esperar <ip> <hash>"; exit 1 ;;
esac
