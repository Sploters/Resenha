#!/bin/sh
# Monta "teste-captura-resenha.zip" (teste da transmissão para Windows 10 e 11): compila lc-audio, lc-stream e o
# lc-stream da PoC (traz o "Jogo de Teste", --jogo-teste) para Windows a partir do Linux
# (rustup target add x86_64-pc-windows-gnu e gcc-mingw-w64-x86-64) e junta os scripts.
# Uso: sh native/pacote-captura/montar.sh [pasta de saída, padrão /tmp/teste-captura-resenha]
set -e
cd "$(dirname "$0")/.."
(cd lc-audio && cargo build --release --target x86_64-pc-windows-gnu)
(cd lc-stream && cargo build --release --target x86_64-pc-windows-gnu)
# pasta de build SEPARADA (target-poc): o target/ normal, de onde o instalador copia, nunca recebe a PoC
(cd lc-stream && cargo build --release --target x86_64-pc-windows-gnu --features poc --target-dir target-poc)
OUT=${1:-/tmp/teste-captura-resenha}; rm -rf "$OUT"; mkdir -p "$OUT"
cp lc-audio/target/x86_64-pc-windows-gnu/release/lc-audio.exe "$OUT/lc-audio.exe"
cp lc-stream/target/x86_64-pc-windows-gnu/release/lc-stream.exe "$OUT/lc-stream.exe"
cp lc-stream/target-poc/x86_64-pc-windows-gnu/release/lc-stream.exe "$OUT/lc-stream-poc.exe"
for f in testar.ps1 LEIA-ME.txt "TESTAR (clique duas vezes).bat"; do sed 's/\r*$/\r/' "pacote-captura/$f" > "$OUT/$f"; done
(cd "$(dirname "$OUT")" && rm -f "$(basename "$OUT").zip" && python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1],'zip','.',sys.argv[1])" "$(basename "$OUT")")
echo "pacote: $OUT.zip"
