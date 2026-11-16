#!/bin/sh
# Monta "poc-captura-dxgi.zip": a prova de conceito WGC x DXGI (lc-stream compilado com --features poc) e os roteiros.
# NAO vai no instalador. Uso: sh native/pacote-poc-dxgi/montar.sh [pasta de saida, padrao /tmp/poc-captura-dxgi]
set -e
cd "$(dirname "$0")/.."
# pasta de build SEPARADA (target-poc): o target/ normal, de onde os outros kits copiam, nunca recebe a PoC
(cd lc-stream && cargo build --release --target x86_64-pc-windows-gnu --features poc --target-dir target-poc)
OUT=${1:-/tmp/poc-captura-dxgi}; rm -rf "$OUT"; mkdir -p "$OUT"
cp lc-stream/target-poc/x86_64-pc-windows-gnu/release/lc-stream.exe "$OUT/lc-stream-poc.exe"
for f in LEIA-ME.txt "1 - TESTE AUTOMATICO.bat" "2 - TESTE MANUAL.bat" "3 - REFAZER RECORTE.bat" "4 - TELA CHEIA SINTETICA.bat"; do sed 's/\r*$/\r/' "pacote-poc-dxgi/$f" > "$OUT/$f"; done
(cd "$(dirname "$OUT")" && rm -f "$(basename "$OUT").zip" && python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1],'zip','.',sys.argv[1])" "$(basename "$OUT")")
echo "pacote: $OUT.zip"
