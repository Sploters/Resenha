// Programas nativos COMPILADOS de verdade (os .exe que vão no instalador): o lc-audio --serve responde ao hello, à
// sondagem, à lista de janelas, ao pedido de tela cheia (fse) e ao vigia do jogo fora do monitor (over: avisa coberta/
// livre de uma janela de verdade); o lc-stream --probe diz o que a placa e o Windows suportam.
// No Windows (GitHub, .github/workflows/windows-testes.yml): usa desktop/native/*.exe e abre uma janela de verdade
// (Bloco de Notas) para o vigia. Fora do Windows: o lc-audio compilado para Linux responde com os dados de teste
// (LC_OVER_TEST), o que confere este script; o lc-stream fica de fora.
// Uso: node scripts/win-native-smoke.mjs   (EXE_DIR=pasta dos programas)
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const WIN = process.platform === 'win32';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const exe = (name) => {
  const c = [process.env.EXE_DIR && path.join(process.env.EXE_DIR, name + (WIN ? '.exe' : '')), WIN && `desktop/native/${name}.exe`,
    `native/${name}/target/release/${name}${WIN ? '.exe' : ''}`, `native/${name}/target/debug/${name}${WIN ? '.exe' : ''}`].filter(Boolean);
  return c.filter(f => fs.existsSync(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; // o mais novo
};

// ---------- lc-audio --serve ----------
const audio = exe('lc-audio');
ok(!!audio, 'lc-audio compilado', audio);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-smoke-')), overFile = path.join(tmp, 'over.txt');
fs.writeFileSync(overFile, '0');
let note = null;
if (audio) {
  const p = spawn(audio, ['--serve'], { env: { ...process.env, LC_OVER_TEST: overFile }, stdio: ['pipe', 'pipe', 'ignore'] });
  const replies = new Map(), events = [];
  createInterface({ input: p.stdout }).on('line', (l) => { try { const j = JSON.parse(l); if (j.ev) events.push(j); else replies.get(j.id)?.(j); } catch { } });
  let id = 0;
  const ask = (op, args = {}, ms = 8000) => new Promise((res) => { const i = ++id; const t = setTimeout(() => res({ timeout: true }), ms); replies.set(i, (j) => { clearTimeout(t); res(j); }); p.stdin.write(JSON.stringify({ id: i, op, ...args }) + '\n'); });
  const waitEv = async (f, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const e = events.find(f); if (e) return e; await sleep(50); } return null; };
  try {
    const hello = await ask('hello');
    ok(hello.r?.v === 1 && hello.r.over === true && hello.r.fse === true, 'hello: versão e o vigia "over" disponível', hello.r);
    const probe = await ask('probe');
    ok(probe.r && typeof probe.r.ok === 'boolean' && (!WIN || probe.r.build >= 10000), 'sondagem: versão do Windows', probe.r);
    const wins = await ask('windows');
    ok(Array.isArray(wins.r), 'lista de janelas', Array.isArray(wins.r) ? wins.r.length + ' janelas' : wins);
    const fse = await ask('fse');
    ok(typeof fse.r?.state === 'string', 'tela cheia (fse): estado do Windows', fse.r);
    if (WIN) {
      // uma janela de verdade: vigia, minimiza e confere o aviso
      note = spawn('notepad.exe', [], { stdio: 'ignore', detached: false });
      let hw = null; for (let i = 0; i < 40 && !hw; i++) { await sleep(250); hw = ((await ask('windows')).r || []).find(w => w.pid === note.pid)?.hwnd; }
      ok(!!hw, 'achou a janela aberta pelo teste na lista', { pid: note.pid, hwnd: hw });
      if (hw) {
        ok((await ask('over', { hwnd: String(hw) })).r === true, 'vigia "over" aceito');
        const e1 = await waitEv(e => e.ev === 'over');
        ok(e1 && typeof e1.covered === 'boolean', 'avisa o estado atual da janela', e1);
        events.length = 0;
        execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);'; [U.W]::ShowWindow([System.IntPtr]${hw}, 6) | Out-Null`]);
        const e2 = await waitEv(e => e.ev === 'over' && e.covered === true && e.why === 'min');
        ok(!!e2, 'minimizada: avisa "fora da tela" (min)', e2 || events);
        await ask('over', { hwnd: '0' });
      }
    } else {
      ok((await ask('over', { hwnd: '55' })).r === true, 'vigia "over" aceito');
      ok(!!(await waitEv(e => e.ev === 'over' && e.covered === false)), 'avisa o estado atual (livre)');
      fs.writeFileSync(overFile, 'min');
      ok(!!(await waitEv(e => e.ev === 'over' && e.covered === true && e.why === 'min')), 'jogo minimizado: avisa');
      fs.writeFileSync(overFile, '1');
      ok(!!(await waitEv(e => e.ev === 'over' && e.covered === true && e.why === 'front')), 'outra janela por cima: avisa');
      await ask('over', { hwnd: '0' });
    }
  } finally { p.stdin.end(); p.kill(); try { note?.kill(); } catch { } }
}

// ---------- lc-stream --probe (só no Windows) ----------
if (WIN) {
  const stream = exe('lc-stream');
  ok(!!stream, 'lc-stream compilado', stream);
  if (stream) {
    let out = ''; try { out = execFileSync(stream, ['--probe'], { timeout: 20000 }).toString(); } catch (e) { out = String(e.stdout || ''); }
    const j = (() => { try { return JSON.parse(out.trim().split('\n').pop()); } catch { return null; } })();
    ok(!!j, 'lc-stream --probe responde em JSON (o que a placa e o Windows suportam)', j || out.slice(0, 200));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FALHA(S)` : '\nNATIVOS OK'); process.exit(fails ? 1 : 0);
