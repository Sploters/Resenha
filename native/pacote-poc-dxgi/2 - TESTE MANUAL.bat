@echo off
cd /d "%~dp0"
echo Teste manual: 3 minutos registrando a captura segundo a segundo (WGC e DXGI lado a lado).
echo Siga o roteiro do LEIA-ME (parte 2) enquanto a contagem anda.
echo.
lc-stream-poc.exe --poc-captura --manual 180
echo.
echo Pronto. Mande o arquivo poc-captura-manual.json desta pasta.
pause
