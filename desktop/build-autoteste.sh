#!/bin/sh
# Monta dist-autoteste/Teste-Transmissao-Resenha.exe: o autoteste da transmissão (autoteste.js) num .exe portátil.
# Dois cliques, ~30 s sem mexer em nada, e o resultado vai para a Área de Trabalho. Precisa do alvo Windows do Rust
# (rustup target add x86_64-pc-windows-gnu) e do mingw para compilar o "Jogo de Teste" (lc-stream da PoC).
set -e
cd "$(dirname "$0")"
(cd ../native/lc-stream && cargo build --release --target x86_64-pc-windows-gnu --features poc --target-dir target-poc)
npx electron-builder --win portable --publish never --config autoteste-builder.cjs
echo "pronto: $(pwd)/dist-autoteste/Teste-Transmissao-Resenha.exe"
