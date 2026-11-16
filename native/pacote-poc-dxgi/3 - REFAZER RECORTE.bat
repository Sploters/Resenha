@echo off
cd /d "%~dp0"
echo Refaz so o teste de recorte de janela (uns 40 segundos). NAO mexa no mouse nem nas janelas.
echo Janelas verde e magenta vao aparecer, andar e sumir: e o teste.
echo.
lc-stream-poc.exe --poc-captura --so-recorte
echo.
echo Pronto. Mande o arquivo poc-captura-recorte.json desta pasta.
pause
