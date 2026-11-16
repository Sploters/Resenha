# Teste da transmissao (Resenha). Nao instala nada e nao muda configuracoes do PC.
# Nao precisa de jogo nenhum: o kit traz um "Jogo de Teste" (janela com animacao calma, sem piscar) que roda em
# TELA CHEIA exclusiva (minimiza no Alt+Tab, como Valorant e outros) ou em JANELA SEM BORDAS.
# Gera resultado-transmissao-<PC>.json nesta pasta. Mande esse arquivo de volta.
$ErrorActionPreference = 'Continue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
$audio = Join-Path $dir 'lc-audio.exe'; $stream = Join-Path $dir 'lc-stream.exe'; $jogo = Join-Path $dir 'lc-stream-poc.exe'
if ($dir -like "$env:TEMP*" -or -not (Test-Path $jogo)) {
  Write-Host ''; Write-Host '  Parece que a pasta nao foi extraida do .zip.' -ForegroundColor Yellow
  Write-Host '  Feche esta janela, clique com o botao direito no .zip > Extrair tudo, e rode o TESTAR da pasta extraida.'
  Read-Host '  Enter para sair'; exit 1
}
function Ask($q, $opts) { while ($true) { $a = (Read-Host "  $q [$($opts -join '/')]").Trim().ToLower(); if ($opts -contains $a) { return $a } } }
function Json($lines) { @($lines | Where-Object { $_ -and $_.Trim().StartsWith('{') } | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } }) }
function ReadJson($f) { if (Test-Path $f) { try { Get-Content -Raw $f | ConvertFrom-Json } catch { $null } } else { $null } }
function StopGame { Get-Process lc-stream-poc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
function StartGame($modo, $secs) {
  StopGame; Remove-Item -ErrorAction SilentlyContinue (Join-Path $dir "jogo-teste-$modo.json")
  # na mesma janela preta, com as mensagens do jogo num arquivo (jogo-teste.log): nao atrapalha as perguntas
  Start-Process -FilePath $jogo -ArgumentList '--poc-captura', '--jogo-teste', '--modo', $modo, '--secs', $secs -WorkingDirectory $dir -NoNewWindow `
    -RedirectStandardError (Join-Path $dir 'jogo-teste.log') -RedirectStandardOutput (Join-Path $dir 'jogo-teste-saida.log') | Out-Null
}
function WaitGame($maxSecs) { $p = Get-Process lc-stream-poc -ErrorAction SilentlyContinue; if ($p) { $p | Wait-Process -Timeout $maxSecs -ErrorAction SilentlyContinue }; StopGame }

$os = Get-CimInstance Win32_OperatingSystem
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = $_.Name; driver = $_.DriverVersion; hz = $_.CurrentRefreshRate; res = "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" } })
$out = [ordered]@{
  kit = 'transmissao-v2'; data = (Get-Date -Format 'yyyy-MM-dd HH:mm'); pc = $env:COMPUTERNAME
  windows = @{ nome = $os.Caption; build = [int]$os.BuildNumber; versao = $os.Version }
  placas = $gpus; monitores = @(Get-CimInstance -Namespace root\wmi WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue).Count
  probe_stream = (Json (& $stream --probe 2>$null)) | Select-Object -First 1
  probe_audio = (Json (& $audio --probe 2>$null)) | Select-Object -First 1
  jogo_teste = @(); transmissoes = @()
}
Write-Host ''; Write-Host '  TESTE DA TRANSMISSAO (Resenha)' -ForegroundColor Cyan
Write-Host "  Windows: $($os.Caption) (build $($os.BuildNumber))"
foreach ($g in $gpus) { Write-Host "  Placa: $($g.name) | driver $($g.driver) | $($g.res) a $($g.hz) Hz" }
Write-Host '  Nao precisa abrir jogo nenhum: o teste usa o "Jogo de Teste (Resenha)" que vem nesta pasta.'
Write-Host '  Ele cobre a tela com uma animacao calma (fundo mudando devagar, barra andando, blocos amarelos). Esc fecha.'

# ---- parte 1: o jogo de teste sozinho (automatico, ~30 s) ----
Write-Host ''; Write-Host '  PARTE 1: automatica (~30 s). Nao mexa no mouse nem no teclado.' -ForegroundColor Cyan
Read-Host '  Aperte Enter para comecar'
foreach ($modo in @('tela-cheia', 'sem-bordas')) {
  Write-Host "  $modo ..."
  StartGame $modo 12; WaitGame 25
  $r = ReadJson (Join-Path $dir "jogo-teste-$modo.json")
  if ($r) { Write-Host ("  {0}: {1} s em tela cheia exclusiva, {2} s na frente; Windows disse 'tela cheia exclusiva' em {3} s" -f $modo, $r.segundosTelaCheia, $r.segundosNaFrente, [int]$r.estadosWindows.'3') }
  else { Write-Host "  $modo : o jogo de teste nao gerou registro" -ForegroundColor Yellow }
  $out.jogo_teste += @{ modo = $modo; registro = $r }
}

# ---- parte 2: transmissao de verdade na Resenha ----
Write-Host ''; Write-Host '  PARTE 2: transmissao na Resenha (4 casos de ~1 minuto)' -ForegroundColor Cyan
Write-Host '  Antes: abra a Resenha, entre numa sala de voz e peca para alguem entrar e ASSISTIR a sua transmissao.'
Write-Host '  Configuracoes > Transmissao: 1080p e 60 FPS (ou 120).'
$casos = @(
  @{ id = 'A'; modo = 'tela-cheia'; fonte = 'janela'; nome = 'Tela cheia + transmitir a JANELA'
     passos = @('O Jogo de Teste vai abrir em TELA CHEIA.',
                'De Alt+Tab para a Resenha (o jogo minimiza: e de proposito, e o que o Valorant faz).',
                'Transmitir > Janelas > "Jogo de Teste (Resenha)" > Transmitir.',
                'Se aparecer o aviso "O jogo esta minimizado...", de Alt+Tab de volta para o jogo.') },
  @{ id = 'B'; modo = 'sem-bordas'; fonte = 'janela'; nome = 'Sem bordas + transmitir a JANELA'
     passos = @('O Jogo de Teste vai abrir em JANELA SEM BORDAS.',
                'De Alt+Tab para a Resenha.',
                'Transmitir > Janelas > "Jogo de Teste (Resenha)" > Transmitir.',
                'De Alt+Tab de volta para o jogo.') },
  @{ id = 'C'; modo = 'tela-cheia'; fonte = 'tela'; nome = 'Tela cheia + transmitir a TELA INTEIRA'
     passos = @('O Jogo de Teste vai abrir em TELA CHEIA.',
                'De Alt+Tab para a Resenha.',
                'Transmitir > Telas > a tela principal > Transmitir.',
                'De Alt+Tab de volta para o jogo.') },
  @{ id = 'D'; modo = 'sem-bordas'; fonte = 'tela'; nome = 'Sem bordas + transmitir a TELA INTEIRA'
     passos = @('O Jogo de Teste vai abrir em JANELA SEM BORDAS.',
                'De Alt+Tab para a Resenha.',
                'Transmitir > Telas > a tela principal > Transmitir.',
                'De Alt+Tab de volta para o jogo.') }
)
foreach ($c in $casos) {
  Write-Host ''; Write-Host "  CASO $($c.id): $($c.nome)" -ForegroundColor Cyan
  $i = 1; foreach ($p in $c.passos) { Write-Host "   $i. $p"; $i++ }
  Write-Host "   $i. Fique uns 30 s no jogo. Depois Alt+Tab para a Resenha: Mais opcoes > Ajustes da transmissao >"
  Write-Host '      "Diagnostico da captura" > "Copiar relatorio do teste". Pare a transmissao e volte para esta janela.'
  $fez = Ask "Fazer o caso $($c.id)? (s = sim, n = pular)" @('s', 'n'); if ($fez -ne 's') { continue }
  try { Set-Clipboard -Value ' ' } catch { }
  StartGame $c.modo 600
  Write-Host '  Jogo de Teste aberto. Siga os passos acima. (Se ele ficar atras desta janela, clique nele.)' -ForegroundColor Green
  Read-Host '  Quando terminar (transmissao parada e relatorio copiado), aperte Enter aqui'
  StopGame; Start-Sleep -Milliseconds 500
  $t = [ordered]@{ caso = $c.id; nome = $c.nome; modo = $c.modo; fonte = $c.fonte }
  $clip = ''; try { $clip = (Get-Clipboard -Raw) } catch { }
  $t.relatorio = $null
  if ($clip -and $clip.Trim().StartsWith('{')) { try { $t.relatorio = $clip | ConvertFrom-Json; Write-Host '  Relatorio da Resenha lido da area de transferencia.' -ForegroundColor Green } catch { } }
  if (-not $t.relatorio) { Write-Host '  Nao achei o relatorio copiado (tudo bem se a transmissao nem comecou).' -ForegroundColor Yellow }
  $t.erro = Ask 'Apareceu erro ao transmitir (ex.: "Could not start video source")? (s/n)' @('s', 'n')
  if ($t.erro -eq 's') { $t.erro_texto = (Read-Host '    Texto do erro (aproximado)').Trim() }
  if ($c.fonte -eq 'janela' -and $c.modo -eq 'tela-cheia') { $t.aviso_minimizado = Ask 'Apareceu o aviso "O jogo esta minimizado..."? (s/n)' @('s', 'n') }
  $t.quem_assiste = Ask 'Quem assistiu viu: animacao andando (a), tela preta (p), imagem parada (c), ninguem assistiu (x)?' @('a', 'p', 'c', 'x')
  $t.obs = (Read-Host '  Observacoes (opcional, Enter para pular)').Trim()
  $t.jogo = ReadJson (Join-Path $dir "jogo-teste-$($c.modo).json")
  $out.transmissoes += $t
}
StopGame
$file = Join-Path $dir ("resultado-transmissao-{0}.json" -f $env:COMPUTERNAME)
$out | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $file
Write-Host ''; Write-Host "  Pronto. Mande este arquivo: $file" -ForegroundColor Green
Read-Host '  Enter para sair'
