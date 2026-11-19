// Prepara desktop/native/lc-input.exe (controle remoto), lc-stream.exe (transmissão a 120 FPS) e lc-audio.exe (áudio só do
// jogo) antes do electron-builder. Os .exe NÃO ficam no repositório (cada versão nova pesava ~5 MB no histórico do git):
// - no Windows com Rust: compila (é o que o GitHub faz em .github/workflows/desktop-release.yml);
// - no Linux com Rust e o alvo x86_64-pc-windows-gnu (rustup target add x86_64-pc-windows-gnu + mingw-w64): compila cruzado;
// - sem Rust: usa o .exe que já estiver em desktop/native (copiado à mão), se houver.
// NATIVE_REQUIRE_BUILD=1 (no GitHub): falha se não conseguir compilar, em vez de usar um .exe velho que esteja na pasta.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const NAMES = ['lc-input', 'lc-stream', 'lc-audio'];
const has = (cmd) => { try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { return false; } };
const cargo = has('cargo --version');
const win = process.platform === 'win32';
const cross = !win && cargo && has('rustup target list --installed | grep -q x86_64-pc-windows-gnu');
const required = process.env.NATIVE_REQUIRE_BUILD === '1';
fs.mkdirSync('native', { recursive: true });

for (const name of NAMES) {
  const out = `native/${name}.exe`;
  if (win && cargo) {
    execSync('cargo build --release --locked', { cwd: `../native/${name}`, stdio: 'inherit' });
    fs.copyFileSync(`../native/${name}/target/release/${name}.exe`, out);
    console.log(`${name}.exe compilado`);
  } else if (cross) {
    execSync('cargo build --release --locked --target x86_64-pc-windows-gnu', { cwd: `../native/${name}`, stdio: 'inherit' });
    fs.copyFileSync(`../native/${name}/target/x86_64-pc-windows-gnu/release/${name}.exe`, out);
    console.log(`${name}.exe compilado (cruzado, windows-gnu)`);
  } else if (!required && fs.existsSync(out)) {
    console.log(`usando o ${name}.exe que já está em desktop/native (Rust não encontrado)`);
  } else {
    console.error(`Falta desktop/native/${name}.exe: instale o Rust (no Windows) ou o alvo x86_64-pc-windows-gnu (no Linux) para compilar native/${name}.`);
    process.exit(1);
  }
}
