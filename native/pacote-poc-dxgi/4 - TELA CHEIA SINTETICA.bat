@echo off
cd /d "%~dp0"
echo Tela cheia sintetica (uns 25 segundos): a tela vai ficar piscando em cores fortes
echo (vermelho, verde, azul, amarelo), primeiro sem bordas e depois em tela cheia exclusiva.
echo Se for sensivel a luzes piscando, NAO rode este teste.
echo NAO mexa no mouse nem no teclado ate voltar para esta janela.
echo.
pause
lc-stream-poc.exe --poc-captura --tela-cheia
echo.
echo Pronto. Mande o arquivo poc-captura-tela-cheia.json desta pasta.
pause
