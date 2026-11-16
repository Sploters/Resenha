# Roteiro de testes da captura (Resenha, Fase 2). Nao instala nada e nao muda configuracoes do PC nem do jogo.
# Gera resultado-captura-<PC>.json nesta pasta. Mande esse arquivo de volta.
# Partes: 1) sistema (Windows, placa, monitor)  2) o que o Windows diz sobre tela cheia exclusiva em cada modo do jogo
#         3) perguntas sobre a transmissao de verdade na Resenha (o que apareceu no "Diagnostico da captura").
$ErrorActionPreference = 'Continue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
$audio = Join-Path $dir 'lc-audio.exe'; $stream = Join-Path $dir 'lc-stream.exe'
if ($dir -like "$env:TEMP*" -or -not (Test-Path $audio)) {
  Write-Host ''; Write-Host '  Parece que a pasta nao foi extraida do .zip.' -ForegroundColor Yellow
  Write-Host '  Feche esta janela, clique com o botao direito no .zip > Extrair tudo, e rode o TESTAR da pasta extraida.'
  Read-Host '  Enter para sair'; exit 1
}
function Ask($q, $opts) { while ($true) { $a = (Read-Host "  $q [$($opts -join '/')]").Trim().ToLower(); if ($opts -contains $a) { return $a } } }
function Json($lines) { @($lines | Where-Object { $_ -and $_.Trim().StartsWith('{') } | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } }) }

$os = Get-CimInstance Win32_OperatingSystem
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = $_.Name; driver = $_.DriverVersion; hz = $_.CurrentRefreshRate; res = "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" } })
$out = [ordered]@{
  kit = 'captura-fase2-v1'; data = (Get-Date -Format 'yyyy-MM-dd HH:mm'); pc = $env:COMPUTERNAME
  windows = @{ nome = $os.Caption; build = [int]$os.BuildNumber; versao = $os.Version }
  placas = $gpus; monitores = @(Get-CimInstance -Namespace root\wmi WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue).Count
  probe_stream = (Json (& $stream --probe 2>$null)) | Select-Object -First 1
  probe_audio = (Json (& $audio --probe 2>$null)) | Select-Object -First 1
  jogo = ''; modos = @(); transmissoes = @()
}
Write-Host ''; Write-Host '  TESTE DA CAPTURA DE JOGOS (Resenha)' -ForegroundColor Cyan
Write-Host "  Windows: $($os.Caption) (build $($os.BuildNumber))"
foreach ($g in $gpus) { Write-Host "  Placa: $($g.name) | driver $($g.driver) | $($g.res) a $($g.hz) Hz" }
Write-Host "  Codificador na placa (lc-stream --probe): $(($out.probe_stream | ConvertTo-Json -Compress))"
Write-Host ''
$out.jogo = (Read-Host '  Qual jogo vai testar? (ex.: Valorant)').Trim()

# ---- parte 2: o que o Windows diz em cada modo de video do jogo ----
Write-Host ''; Write-Host '  PARTE 2: modos de video do jogo (3 rodadas de ~30 s)' -ForegroundColor Cyan
Write-Host '  Em cada rodada: deixe o jogo no modo pedido, volte aqui, aperte Enter e VOLTE PARA O JOGO em ate 5 s.'
Write-Host '  Fique no jogo (pode jogar ou ficar no menu) ate ouvir o bipe. Nao precisa transmitir nesta parte.'
foreach ($modo in @('Tela cheia', 'Janela sem bordas', 'Janela')) {
  Write-Host ''; Read-Host "  Coloque o jogo em `"$modo`" e aperte Enter"
  $lines = & $audio --fse 30 2>$null
  [console]::Beep(880, 300)
  $r = Json $lines
  $emJogo = @($r | Where-Object { $_.fg -and $_.fg.title -and $_.fg.exe -notlike '*powershell*' -and $_.fg.exe -notlike '*WindowsTerminal*' })
  $d3d = @($emJogo | Where-Object { $_.state -eq 'd3d_fullscreen' }).Count
  Write-Host ("  {0}: {1} de {2} segundos com o jogo na frente; Windows disse 'tela cheia exclusiva' em {3}" -f $modo, $emJogo.Count, $r.Count, $d3d)
  $gb = Ask 'Com o jogo neste modo, a Xbox Game Bar (Windows + G) aparece POR CIMA do jogo (s) ou o jogo minimiza (m)? (n = nao testei)' @('s', 'm', 'n')
  $out.modos += @{ modo = $modo; segundos = $r.Count; com_jogo_na_frente = $emJogo.Count; d3d_fullscreen = $d3d; estados = @($r | Group-Object state | ForEach-Object { @{ estado = $_.Name; n = $_.Count } }); gamebar = $gb; amostras = $r }
}

# ---- parte 3: transmissao de verdade na Resenha ----
Write-Host ''; Write-Host '  PARTE 3: transmissao na Resenha (repita para os casos que conseguir)' -ForegroundColor Cyan
Write-Host '  Para cada caso: entre numa sala, transmita a JANELA do jogo (ou a tela inteira, quando pedido) a 1080p 60 FPS,'
Write-Host '  jogue ~1 minuto e abra: Mais opcoes > Ajustes da transmissao > "Diagnostico da captura".'
Write-Host '  Peca para alguem assistindo dizer se a imagem chega e se trava.'
$casos = @('Tela cheia + janela do jogo', 'Janela sem bordas + janela do jogo', 'Tela cheia + tela inteira', 'Janela sem bordas + tela inteira')
foreach ($c in $casos) {
  Write-Host ''; $fez = Ask "Testou: $c ? (s/n)" @('s', 'n'); if ($fez -ne 's') { continue }
  $t = [ordered]@{ caso = $c }
  $t.metodo = (Read-Host '    "Metodo em uso" no diagnostico (copie o texto)').Trim()
  $t.capturando = (Read-Host '    "Capturando" (quadros/s)').Trim()
  $t.enviando = (Read-Host '    "Enviando" (FPS e resolucao)').Trim()
  $t.codificador = (Read-Host '    "Codificador"').Trim()
  $t.por_que_nao_nativo = (Read-Host '    "Por que nao o nativo" (vazio se nao apareceu)').Trim()
  $t.reinicios = (Read-Host '    "Reinicios do nativo" (vazio se nao apareceu)').Trim()
  $t.ajuste = (Read-Host '    "Ajuste automatico" (vazio se nao apareceu)').Trim()
  $t.tela_cheia_diag = (Read-Host '    "Tela cheia exclusiva" no diagnostico (nao / so o Windows indica / confirmada / sem dados)').Trim()
  $t.aviso_apareceu = Ask '    Apareceu o aviso de tela cheia exclusiva na Resenha?' @('s', 'n')
  $t.imagem_para_quem_assiste = Ask '    Quem assiste via: o jogo normal (j), imagem preta (p), imagem parada (c)?' @('j', 'p', 'c')
  $t.fps_jogo_sem = (Read-Host '    FPS do jogo SEM transmitir (aprox., vazio se nao sabe)').Trim()
  $t.fps_jogo_com = (Read-Host '    FPS do jogo TRANSMITINDO (aprox., vazio se nao sabe)').Trim()
  $t.alt_tab = Ask '    Deu Alt+Tab e voltou: a transmissao voltou sozinha em poucos segundos? (s/n/x = nao testei)' @('s', 'n', 'x')
  $t.obs = (Read-Host '    Observacoes (opcional)').Trim()
  $out.transmissoes += $t
}
$file = Join-Path $dir ("resultado-captura-{0}.json" -f $env:COMPUTERNAME)
$out | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $file
Write-Host ''; Write-Host "  Pronto. Mande este arquivo: $file" -ForegroundColor Green
Read-Host '  Enter para sair'
