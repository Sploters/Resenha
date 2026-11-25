#!/bin/sh
# Lado do servidor do deploy (chamado por deploy/umbrel.sh depois de copiar o código para ~/resenha).
# Uso: sh servidor.sh instalar <ip> <forcar 0|1>                (monta a imagem e atualiza)
#      sh servidor.sh esperar  <ip> <tipo> <hash-voz> <hash-app>  (espera em segundo plano; quem chama é o "instalar")
#
# Como o Discord: ninguém precisa sair da chamada para atualizar. No container rodam dois processos: o da voz
# (server/voz.js, mediasoup: as chamadas) e, como filho dele, o app (server/index.js: site, chat, banco). Três níveis:
# 1. Só a interface mudou (public/): troca os arquivos dentro do container e manda SIGHUP. Nada reinicia; as páginas
#    recebem a versão nova e recarregam quando não atrapalha (public/uiupdate.js).
# 2. O app mudou (server/, menos a voz): troca o código dentro do container e manda SIGUSR2. Só o app reinicia (~2 s); as
#    chamadas continuam no processo da voz e cada app retoma a sessão. Espera só por bot de música e "assistir junto",
#    que vivem no app e acabariam ("sessoes" em em-chamada.json).
# 3. A voz mudou (server/voz.js, server/sfu.js, dependências, Dockerfile) ou primeira vez: troca o container (as chamadas
#    caem ~6 s e voltam sozinhas). Espera não haver chamada ATIVA (2+ pessoas conversando ou transmitindo; ver
#    callActive em server/index.js) nem sessões. Sozinho ou em silêncio na call não segura.
# Com espera: fica em segundo plano no servidor (pode fechar o terminal). Pendente há mais de ESPERA_HORAS (24), troca de
# madrugada (3 h às 6 h, fuso FUSO) mesmo assim. FORCAR=1 troca o container na hora, sempre.
# Estado em ~/.resenha-deploy: rodando-voz e rodando-app (hash do que está no ar), pendente (desde quando espera),
# espera.pid (o processo que espera) e espera.log.
set -e
MODO=$1; IP=$2
EST=$HOME/.resenha-deploy; mkdir -p "$EST"
F=$HOME/resenha-data/em-chamada.json
ESPERA_HORAS=${ESPERA_HORAS:-24}; FUSO=${FUSO:-America/Sao_Paulo}

hash_de() { (cd "$HOME/resenha" && find "$@" -type f 2>/dev/null | LC_ALL=C sort | xargs sha1sum | sha1sum | cut -c1-40); }
# o que só muda com o container novo: o processo da voz, o SFU, as dependências e a imagem
# ~/resenha-voz.env (opcional, fora do repositório): variáveis da voz, como TURN_URL e TURN_SECRET (docs/TURN.md). Só valem
# com o container novo, então mudar o arquivo também conta como "a voz mudou" (sem o arquivo o hash fica igual ao de antes)
hash_voz() {
  H=$(hash_de server/voz.js server/sfu.js server/ipv6watch.js package.json package-lock.json Dockerfile)
  if [ -f "$HOME/resenha-voz.env" ]; then echo "$H $(sha1sum < "$HOME/resenha-voz.env")" | sha1sum | cut -c1-40; else echo "$H"; fi
}
# o resto do servidor (o app reinicia sozinho dentro do container)
hash_app() { hash_de server PRIVACIDADE.md SECURITY.md scripts/reset-password.mjs; }

# lê um número de em-chamada.json. O servidor grava a cada 10 s; arquivo velho (servidor parado) = 0.
campo() {
  [ -f "$F" ] || { echo 0; return; }
  T=$(sed -n 's/.*"t":\([0-9]*\).*/\1/p' "$F")
  { [ -n "$T" ] && [ $(( $(date +%s) - T / 1000 )) -lt 60 ]; } || { echo 0; return; }
  N=$(sed -n "s/.*\"$1\":\([0-9]*\).*/\1/p" "$F")
  # servidor antigo, sem "emAtivas": conta todo mundo em chamada, como antes
  [ -z "$N" ] && [ "$1" = emAtivas ] && N=$(sed -n 's/.*"inCalls":\([0-9]*\).*/\1/p' "$F")
  echo "${N:-0}"
}
# o que segura cada tipo de troca (vazio = pode trocar)
segura() {
  S=$(campo sessoes)
  if [ "$1" = voz ]; then N=$(campo emAtivas); [ "$N" -gt 0 ] && { echo "$N pessoa(s) em chamada com conversa acontecendo"; return; }; fi
  [ "$S" -gt 0 ] && echo "$S sala(s) com bot de música ou assistindo junto"
  return 0
}
madrugada() { H=$(TZ=$FUSO date +%H); [ "$H" = 03 ] || [ "$H" = 04 ] || [ "$H" = 05 ]; }
# a espera roda com setsid (líder do próprio grupo): mata o grupo inteiro, senão o sleep em andamento a deixaria viva
parar_espera() {
  if [ -f "$EST/espera.pid" ]; then P=$(cat "$EST/espera.pid"); kill -- "-$P" 2>/dev/null || kill "$P" 2>/dev/null || true; fi
  rm -f "$EST/espera.pid"
}

backup_parado() {
  DB=$(cd "$HOME/resenha-data" 2>/dev/null && ls resenha.db resenha.db-wal localcord.db localcord.db-wal 2>/dev/null || true)
  [ -n "$DB" ] || return 0
  mkdir -p "$HOME/resenha-backups"
  T="$HOME/resenha-backups/data-$(date +%Y%m%d-%H%M%S).tgz"
  # temporário + renomear: cópia pela metade (disco cheio) não fica com cara de cópia boa
  if tar czf "$T.tmp" -C "$HOME/resenha-data" $DB && gzip -t "$T.tmp"; then mv "$T.tmp" "$T"; else rm -f "$T.tmp"; echo "AVISO: cópia do banco falhou (disco cheio?)"; fi
  ls -1t "$HOME"/resenha-backups/data-*.tgz 2>/dev/null | tail -n +$(( ${BACKUPS_MANTER:-20} + 1 )) | xargs -r rm -f
}
trocar_container() { # $1 = hash da voz, $2 = hash do app
  # cookies do YouTube (opcional): ~/resenha-data/cookies.txt. Chave da Steam (opcional): ~/resenha-steam.env com a
  # linha STEAM_API_KEY=suachave (fora do repositório e da pasta de dados; crie em steamcommunity.com/dev/apikey).
  # O mesmo arquivo serve para OPENCRITIC_KEY=suachave (nota da crítica no popup do jogo)
  COOKIES=; [ -f "$HOME/resenha-data/cookies.txt" ] && COOKIES='-e YTDLP_COOKIES=/data/cookies.txt'
  STEAM=; [ -f "$HOME/resenha-steam.env" ] && STEAM="--env-file $HOME/resenha-steam.env"
  VOZ=; [ -f "$HOME/resenha-voz.env" ] && VOZ="--env-file $HOME/resenha-voz.env" # TURN etc. (docs/TURN.md)
  # docker stop (não rm -f, que mata na hora): o servidor avisa os apps que está atualizando antes de fechar
  docker stop -t 10 resenha >/dev/null 2>&1 || true
  # cópia do banco com o servidor JÁ parado (fechou o banco com checkpoint: resenha.db inteiro, -wal vazio). Antes era
  # feita com ele no ar, e o tar de resenha.db + -wal enquanto alguém escreve pode sair inconsistente. Guarda as
  # BACKUPS_MANTER (20) mais novas; as automáticas diárias ficam em ~/resenha-data/backups (server/backup.js)
  backup_parado
  docker rm -f resenha >/dev/null 2>&1 || true
  # IPv6 público (a internet de casa tem CGNAT no IPv4): o container do Resenha não enxerga o IPv6 do host, então um
  # container pequeno na rede do host grava o endereço em ~/resenha-data/ipv6 a cada minuto (server/ipv6watch.js) e a voz
  # o anuncia na porta 40030 (server/sfu.js). Sobe antes, para o arquivo já existir quando a voz abrir
  docker rm -f resenha-ipv6 >/dev/null 2>&1 || true
  docker run -d --name resenha-ipv6 --restart=always --network host --no-healthcheck \
    -v "$HOME/resenha-data:/data" resenha node server/ipv6watch.js >/dev/null
  sleep 2
  echo "IPv6 público: $(cat "$HOME/resenha-data/ipv6" 2>/dev/null || echo 'nenhum')"
  docker run -d --name resenha --restart=always \
    -p 3000:3000 -p 3443:3443 -p 40000:40000/udp -p 40000:40000/tcp -p 40001-40010:40001-40010/udp \
    -p 40030:40030/udp -p 40030:40030/tcp \
    -v "$HOME/resenha-data:/data" -e TLS_SAN=IP:$IP -e RTC_ANNOUNCED_IP=$IP $COOKIES $STEAM $VOZ resenha >/dev/null
  echo "$1" > "$EST/rodando-voz"; echo "$2" > "$EST/rodando-app"; rm -f "$EST/rodando" "$EST/pendente"
  sleep 4
  docker logs resenha 2>&1 | head -3
}
# troca pastas inteiras dentro do container (nada de arquivo velho sobrando): /app/<pasta> <- ~/resenha/<pasta>
copiar_para_container() {
  for d in "$@"; do docker cp "$HOME/resenha/$d" "resenha:/app/$d.new"; done
  docker exec resenha sh -c "for d in $*; do rm -rf /app/\$d.old && mv /app/\$d /app/\$d.old && mv /app/\$d.new /app/\$d && rm -rf /app/\$d.old; done"
}
reiniciar_app() { # $1 = hash do app
  copiar_para_container server public
  docker cp "$HOME/resenha/PRIVACIDADE.md" resenha:/app/PRIVACIDADE.md
  docker cp "$HOME/resenha/SECURITY.md" resenha:/app/SECURITY.md
  docker cp "$HOME/resenha/scripts/reset-password.mjs" resenha:/app/scripts/reset-password.mjs
  docker kill -s USR2 resenha >/dev/null
  echo "$1" > "$EST/rodando-app"; rm -f "$EST/pendente"
  sleep 4
  docker logs --since 10s resenha 2>&1 | grep -E '\[voz\]|Voz:|Resenha rodando' || true
}
aplicar() { # $1 = tipo (voz|app), $2 = hash da voz, $3 = hash do app
  if [ "$1" = voz ]; then trocar_container "$2" "$3"; else reiniciar_app "$3"; fi
}

case "$MODO" in
instalar)
  FORCAR=${3:-0}
  cd "$HOME/resenha"
  docker build -q --build-arg YTDLP_BUST=$(date +%Y%m%d) -t resenha . >/dev/null # yt-dlp novo a cada dia de deploy (o YouTube muda)
  HV=$(hash_voz); HA=$(hash_app)
  RV=$(cat "$EST/rodando-voz" 2>/dev/null || true); RA=$(cat "$EST/rodando-app" 2>/dev/null || true)
  ATIVO=$(docker inspect -f '{{.State.Running}}' resenha 2>/dev/null || echo false)
  parar_espera # deploy novo substitui qualquer espera anterior

  if [ "$FORCAR" = 1 ] || [ "$ATIVO" != true ] || [ -z "$RV" ] || [ "$HV" != "$RV" ]; then TIPO=voz
  elif [ "$HA" != "$RA" ]; then TIPO=app
  else TIPO=interface; fi

  if [ "$TIPO" = interface ]; then
    rm -f "$EST/pendente"
    copiar_para_container public
    docker kill -s HUP resenha >/dev/null
    sleep 2
    docker logs --since 15s resenha 2>&1 | grep -E 'Interface|SIGHUP' || true
    echo "Só a interface mudou: atualizada sem reiniciar nada. Cada página recarrega quando não atrapalhar."
    exit 0
  fi

  MOTIVO=$(segura $TIPO)
  if [ "$FORCAR" = 1 ] || [ "$ATIVO" != true ] || [ -z "$MOTIVO" ]; then
    [ "$FORCAR" = 1 ] && [ -n "$MOTIVO" ] && echo "FORCAR=1: trocando com $MOTIVO (as chamadas voltam sozinhas em segundos)."
    if [ "$TIPO" = app ]; then echo "O servidor mudou (a voz não): reiniciando só o app. As chamadas continuam."
    else echo "A voz/as dependências mudaram (ou é a primeira vez com este deploy): trocando o container."; fi
    aplicar $TIPO "$HV" "$HA"
    exit 0
  fi
  [ -f "$EST/pendente" ] || date +%s > "$EST/pendente"
  cp "$HOME/resenha/deploy/servidor.sh" "$EST/servidor.sh" # cópia: um deploy novo pode trocar o arquivo original
  setsid nohup sh "$EST/servidor.sh" esperar "$IP" "$TIPO" "$HV" "$HA" >> "$EST/espera.log" 2>&1 < /dev/null &
  echo $! > "$EST/espera.pid"
  if [ "$TIPO" = app ]; then echo "Agora: $MOTIVO (reiniciar o app encerraria isso). As chamadas em si não seriam afetadas."
  else echo "Agora: $MOTIVO. Esta atualização troca o container (a voz mudou), o que derruba as chamadas por segundos."; fi
  echo "A imagem nova está pronta e entra sozinha quando isso acabar. Pendente há mais de ${ESPERA_HORAS} h: entra de madrugada mesmo assim."
  echo "Pode fechar o terminal. Acompanhar: ssh no servidor e tail -f ~/.resenha-deploy/espera.log  |  Trocar já: FORCAR=1"
  ;;
esperar)
  TIPO=$3; HV=$4; HA=$5
  echo "$(date '+%F %T') esperando para atualizar ($TIPO; voz $HV, app $HA)"
  AVISO=0
  while :; do
    MOTIVO=$(segura "$TIPO"); DESDE=$(cat "$EST/pendente" 2>/dev/null || date +%s)
    if [ -z "$MOTIVO" ]; then echo "$(date '+%F %T') liberado: atualizando"; aplicar "$TIPO" "$HV" "$HA"; break; fi
    if [ $(( $(date +%s) - DESDE )) -ge $(( ESPERA_HORAS * 3600 )) ] && madrugada; then
      echo "$(date '+%F %T') pendente há mais de ${ESPERA_HORAS} h: atualizando de madrugada mesmo com $MOTIVO"
      aplicar "$TIPO" "$HV" "$HA"; break
    fi
    [ $(( $(date +%s) - AVISO )) -ge 1800 ] && { echo "$(date '+%F %T') $MOTIVO; esperando"; AVISO=$(date +%s); }
    sleep 15
  done
  rm -f "$EST/espera.pid"
  ;;
*) echo "uso: $0 instalar <ip> [forcar] | esperar <ip> <tipo> <hash-voz> <hash-app>"; exit 1 ;;
esac
