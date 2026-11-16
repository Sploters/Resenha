#!/bin/sh
# Monta Teste-Transmissao-Resenha.exe (~4 MB): o autoteste da transmissão para Windows 10 e 11.
# É o lc-stream da PoC (--features poc, fora do instalador) com outro nome: com esse nome ele roda o autoteste sozinho
# (dois cliques, ~30 s, resultado na Área de Trabalho). Ver docs/TESTE-CAPTURA-AMIGOS.md.
# Uso: sh native/autoteste/montar.sh [pasta de saída, padrão /tmp]
set -e
OUT=$(mkdir -p "${1:-/tmp}" && cd "${1:-/tmp}" && pwd)
cd "$(dirname "$0")/../lc-stream"
cargo build --release --target x86_64-pc-windows-gnu --features poc --target-dir target-poc
cp target-poc/x86_64-pc-windows-gnu/release/lc-stream.exe "$OUT/Teste-Transmissao-Resenha.exe"
echo "pronto: $OUT/Teste-Transmissao-Resenha.exe"
