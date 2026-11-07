// Janelinha "Atualizando o Resenha…" enquanto o instalador roda em silêncio (o app já fechou).
// IMPORTANTE: quem abre o instalador é o próprio app (desktop/main.js), direto, como sempre funcionou. Esta janela é só
// um acompanhamento: se o PowerShell não abrir (antivírus, política do Windows), a atualização acontece do mesmo jeito.
// Nas versões 1.0.30 a 1.0.32 o instalador era aberto POR DENTRO do PowerShell e, quando ele era barrado, o app fechava
// e nada era instalado.
// O que a janela faz: espera o instalador (pelo PID) terminar, fecha e, se o app não reabriu sozinho em alguns
// segundos, abre o app (o --force-run do instalador às vezes não reabre). Anota o resultado em update.log.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function Log($m) { Add-Content -LiteralPath $env:LC_LOG -Value ((Get-Date -Format s) + ' ' + $m) }
$pidI = [int]$env:LC_PID
Log ('janela de atualizacao aberta; instalador pid ' + $pidI)
$f = $null
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  [Windows.Forms.Application]::EnableVisualStyles()
  $f = New-Object Windows.Forms.Form
  $f.Text = 'Resenha'; $f.FormBorderStyle = 'None'; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true; $f.ShowInTaskbar = $true
  $f.ClientSize = New-Object Drawing.Size(360, 104); $f.BackColor = [Drawing.Color]::FromArgb(43, 45, 49)
  if ($env:LC_ICON -and (Test-Path -LiteralPath $env:LC_ICON)) { $f.Icon = New-Object Drawing.Icon($env:LC_ICON) }
  $t = New-Object Windows.Forms.Label
  $t.Text = $env:LC_TITLE; $t.ForeColor = [Drawing.Color]::FromArgb(242, 243, 245)
  $t.Font = New-Object Drawing.Font('Segoe UI', 12, [Drawing.FontStyle]::Bold); $t.SetBounds(22, 18, 320, 26)
  $s = New-Object Windows.Forms.Label
  $s.Text = $env:LC_SUB; $s.ForeColor = [Drawing.Color]::FromArgb(181, 186, 193)
  $s.Font = New-Object Drawing.Font('Segoe UI', 9.5); $s.SetBounds(22, 46, 320, 20)
  $b = New-Object Windows.Forms.ProgressBar
  $b.Style = 'Marquee'; $b.MarqueeAnimationSpeed = 20; $b.SetBounds(22, 76, 316, 8)
  $f.Controls.AddRange(@($t, $s, $b))
} catch { Log ('janela nao abriu: ' + $_); $f = $null }
$start = Get-Date
$running = { $null -ne (Get-Process -Id $pidI -ErrorAction SilentlyContinue) }
if ($f) {
  $tm = New-Object Windows.Forms.Timer; $tm.Interval = 300
  $tm.Add_Tick({ if (-not (& $running) -or ((Get-Date) - $start).TotalSeconds -gt 240) { $tm.Stop(); $f.Close() } })
  $f.Add_Shown({ $tm.Start(); $f.Activate() })
  [void]$f.ShowDialog()
} else {
  while ((& $running) -and ((Get-Date) - $start).TotalSeconds -lt 240) { Start-Sleep -Milliseconds 500 }
}
Log ('instalador terminou em ' + [int]((Get-Date) - $start).TotalSeconds + ' s')
# o instalador deveria reabrir o app (--force-run); se não reabriu, abre aqui
Start-Sleep -Seconds 4
$name = [IO.Path]::GetFileNameWithoutExtension($env:LC_EXE)
if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) {
  Log 'app nao reabriu sozinho: abrindo'
  Start-Process -FilePath $env:LC_EXE
}
`;

// o: { pid (do instalador), exe (o Resenha.exe instalado), version, icon, dir (pasta para o script e o log) }
function watchInstall(o, log = () => { }) {
  if (process.platform !== 'win32' || !o.pid) return;
  try {
    const file = path.join(o.dir, 'resenha-update.ps1');
    fs.writeFileSync(file, '﻿' + SCRIPT.replace(/\n/g, '\r\n'), 'utf8'); // BOM: o Windows PowerShell lê os acentos certo
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, LC_PID: String(o.pid), LC_EXE: o.exe, LC_ICON: o.icon || '', LC_LOG: path.join(o.dir, 'update.log'),
        LC_TITLE: o.version ? `Atualizando o Resenha para ${o.version}…` : 'Atualizando o Resenha…', LC_SUB: 'Leva alguns segundos. O app abre sozinho quando terminar.' },
    });
    p.on('error', (e) => log('janela de atualização não abriu (a instalação segue):', e.message));
    p.unref();
  } catch (e) { log('janela de atualização não abriu (a instalação segue):', e.message); }
}

module.exports = { watchInstall };
