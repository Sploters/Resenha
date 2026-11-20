#!/bin/sh
# Envia o código para o Umbrel, reconstrói a imagem e recria o container com os mesmos dados.
# Uso: sh deploy/umbrel.sh [usuario@host] [ip-da-vpn]
# Requer chave SSH no servidor e o usuário no grupo docker.
# Ninguém precisa sair da chamada: a voz roda num processo próprio no container (server/voz.js). O deploy faz o menor
# reinício possível (detalhes em deploy/servidor.sh e docs/ATUALIZACOES-E-RELATORIOS.md):
# - só a interface mudou: nada reinicia;
# - o servidor mudou: só o app reinicia, as chamadas continuam (espera só por bot de música / assistir junto);
# - a voz ou as dependências mudaram: troca o container sem conversa acontecendo (sozinho ou em silêncio não conta);
#   senão espera em segundo plano no servidor (pode fechar o terminal) e, pendente há mais de 24 h, entra de madrugada.
#   FORCAR=1 sh deploy/umbrel.sh   troca na hora mesmo com chamada ativa (todos voltam sozinhos em segundos)
set -e
# O endereço do servidor não fica no repositório: passe como argumento ou crie deploy/servidor.conf
# (ignorado pelo git) com a linha: SERVIDOR=usuario@ip-da-vpn
[ -f "$(dirname "$0")/servidor.conf" ] && . "$(dirname "$0")/servidor.conf"
TARGET=${1:-$SERVIDOR}
[ -n "$TARGET" ] || { echo "Informe o servidor: sh $0 usuario@ip-da-vpn  (ou crie deploy/servidor.conf com SERVIDOR=usuario@ip)"; exit 1; }
IP=${2:-${TARGET#*@}}
FORCAR=${FORCAR:-0}
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
  # o resto (montar a imagem, trocar só a interface ou o servidor inteiro, esperar chamada ativa) fica em deploy/servidor.sh
  ESPERA_HORAS=${ESPERA_HORAS:-24} FUSO=${FUSO:-America/Sao_Paulo} sh deploy/servidor.sh instalar $IP $FORCAR
"
