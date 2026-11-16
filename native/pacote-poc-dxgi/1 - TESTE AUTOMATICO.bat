@echo off
cd /d "%~dp0"
echo Teste automatico da captura (uns 2 minutos). NAO mexa no mouse nem nas janelas ate terminar.
echo Janelas coloridas (verde, magenta e uma pequena piscando) vao aparecer e sumir: e o teste.
echo.
lc-stream-poc.exe --poc-captura
echo.
echo Pronto. Mande o arquivo poc-captura-resultado.json desta pasta.
pause
