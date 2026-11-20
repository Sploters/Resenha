# Mede o consumo do Resenha Desktop no Windows durante N segundos: CPU, memória privada, GPU e VRAM de cada processo
# (Resenha.exe por tipo: principal, renderer, gpu, áudio, rede...; e os nativos lc-stream, lc-audio, lc-input).
# Uso (PowerShell, com o Resenha aberto no modo que quer medir):
#   powershell -ExecutionPolicy Bypass -File medir-resenha.ps1 -Label ocioso -Secs 60
# Grava resenha-<Label>.csv na pasta atual e mostra o resumo na tela. Só lê contadores; não muda nada.
param([string]$Label = 'modo', [int]$Secs = 60)
$names = 'Resenha', 'lc-stream', 'lc-audio', 'lc-input'
$cores = [Environment]::ProcessorCount
$cim = @{}; Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(Resenha|lc-stream|lc-audio|lc-input)\.exe$' } | ForEach-Object { $cim[[int]$_.ProcessId] = $_.CommandLine }
$p0 = @{}; Get-Process -Name $names -ErrorAction SilentlyContinue | ForEach-Object { $p0[$_.Id] = $_.TotalProcessorTime.TotalSeconds }
if (-not $p0.Count) { Write-Host 'Resenha não está aberto.'; exit 1 }
Write-Host "Medindo '$Label' por $Secs s ($($p0.Count) processos)... não mexa no PC."
$n = [math]::Max(1, [int]($Secs / 2))
$samples = Get-Counter '\GPU Engine(*)\Utilization Percentage', '\GPU Process Memory(*)\Dedicated Usage' -SampleInterval 2 -MaxSamples $n -ErrorAction SilentlyContinue
$gpu = @{}; $vram = @{}
foreach ($s in $samples) { foreach ($c in $s.CounterSamples) {
  if ($c.InstanceName -match 'pid_(\d+)_') { $id = [int]$matches[1]
    if ($c.Path -like '*utilization percentage') { $gpu[$id] = ($gpu[$id] + $c.CookedValue) }
    elseif ($c.CookedValue -gt $vram[$id]) { $vram[$id] = $c.CookedValue } } } }
$rows = foreach ($p in Get-Process -Name $names -ErrorAction SilentlyContinue) {
  $cl = $cim[$p.Id]; $type = if ($cl -match '--type=([\w-]+)') { $matches[1] + $(if ($cl -match '--utility-sub-type=[\w.]*\.(\w+)') { ':' + $matches[1] } else { '' }) } elseif ($p.ProcessName -eq 'Resenha') { 'principal' } else { $p.ProcessName }
  $cpu = if ($p0.ContainsKey($p.Id)) { ($p.TotalProcessorTime.TotalSeconds - $p0[$p.Id]) / $Secs / $cores * 100 } else { $null }
  [pscustomobject]@{ Modo = $Label; Processo = $p.ProcessName; Tipo = $type; PID = $p.Id
    'CPU % (do PC todo)' = [math]::Round($cpu, 2); 'Memória privada MB' = [math]::Round($p.PrivateMemorySize64 / 1MB)
    'GPU % (média)' = [math]::Round(($gpu[$p.Id]) / $n, 2); 'VRAM MB (pico)' = [math]::Round($vram[$p.Id] / 1MB) } }
$rows | Sort-Object 'CPU % (do PC todo)' -Descending | Format-Table -AutoSize
$t = $rows | Measure-Object 'CPU % (do PC todo)', 'Memória privada MB', 'GPU % (média)', 'VRAM MB (pico)' -Sum
Write-Host ("TOTAL  CPU {0:N2}%  memória {1} MB  GPU {2:N2}%  VRAM {3} MB  processos {4}" -f $t[0].Sum, $t[1].Sum, $t[2].Sum, $t[3].Sum, $rows.Count)
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 "resenha-$Label.csv"
