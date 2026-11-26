// Atualizações do app desktop entregues pelo próprio servidor: o repositório no GitHub pode ser privado.
// O servidor consulta a release mais nova com uma chave de acesso (somente leitura) e entrega o instalador aos apps.
// - Chave: variável GITHUB_TOKEN ou o arquivo <pasta de dados>/github-token.txt (no Umbrel: ~/resenha-data/github-token.txt).
//   Sem chave, funciona só se o repositório for público.
// - GET /api/desktop/update            -> { version, name, size, url, signature } da release mais nova (ou {} se não houver)
//   signature: o conteúdo de Resenha-Setup-X.exe.sig (assinatura Ed25519 feita no GitHub Actions; scripts/update-sign.mjs).
//   O servidor só repassa: quem confere é o app, com a chave pública embutida nele. Servidor invadido não consegue
//   fazer o app instalar outra coisa.
// - GET /desktop/download/<instalador> -> o instalador (baixado do GitHub uma vez e guardado em <dados>/desktop)
// - Atualização por diferença (só o app.asar, ~200 KB: desktop/overlay.js): a release traz Resenha-app-X.asar e .sig; a
//   resposta ganha asar: { name, size, url, signature }. Desligada até o dono ligar (DESKTOP_ASAR=1 ou o arquivo
//   <dados>/desktop-asar.txt com 1), depois de testar no Windows. O app só usa se o Electron e os nativos forem os mesmos.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { log } from './log.js';

const L = log('desktop-update');

const SETUP = /^Resenha-Setup-\d+\.\d+\.\d+\.exe$/i, ASAR = /^Resenha-app-\d+\.\d+\.\d+\.asar$/;
const MAX_SIZE = 512 * 2 ** 20, MAX_MS = 20 * 60e3; // instalador: no máximo 512 MB e 20 min para baixar do GitHub

export function mountDesktopUpdate(app, dataDir) {
  const REPO = process.env.DESKTOP_REPO || 'Sploters/Resenha';
  const dir = path.join(dataDir, 'desktop');
  const token = () => {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
    try { return fs.readFileSync(path.join(dataDir, 'github-token.txt'), 'utf8').trim(); } catch { return ''; }
  };
  // pedido ao GitHub (segue redirecionamentos; a chave só vai para api.github.com)
  const get = (url, accept, hops = 5) => new Promise((resolve, reject) => {
    const u = new URL(url), t = u.hostname === 'api.github.com' ? token() : '';
    const req = https.get(u, { headers: { 'User-Agent': 'Resenha', Accept: accept, ...(t ? { Authorization: `Bearer ${t}` } : {}) }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) { res.resume(); resolve(get(new URL(res.headers.location, u).href, accept, hops - 1)); return; }
      resolve(res);
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
  });
  const json = async (url) => { const r = await get(url, 'application/vnd.github+json'); let b = ''; for await (const c of r) b += c; if (r.statusCode !== 200) throw new Error(`GitHub ${r.statusCode}`); return JSON.parse(b); };

  const asarOn = () => process.env.DESKTOP_ASAR === '1' || (() => { try { return fs.readFileSync(path.join(dataDir, 'desktop-asar.txt'), 'utf8').trim() === '1'; } catch { return false; } })();
  const sigOf = async (j, a) => { // .sig pequeno (~300-500 bytes): vai junto na resposta
    const sa = a && (j.assets || []).find(x => x.name === a.name + '.sig'); if (!sa) return null;
    const r = await get(`https://api.github.com/repos/${REPO}/releases/assets/${sa.id}`, 'application/octet-stream');
    let b = ''; for await (const c of r) { b += c; if (b.length > 8192) break; }
    if (r.statusCode !== 200) return null; try { return JSON.parse(b); } catch { return null; }
  };
  let cache = { at: 0, rel: null, err: '' };
  async function latest() {
    if (Date.now() - cache.at < 2 * 60e3) return cache.rel; // 2 min: versão recém-publicada aparece logo
    try {
      const j = await json(`https://api.github.com/repos/${REPO}/releases/latest`);
      const a = (j.assets || []).find(x => SETUP.test(x.name)), sa = a && (j.assets || []).find(x => x.name === a.name + '.sig');
      let signature = null;
      if (sa) { // pequeno (~300 bytes): vai junto na resposta
        const r = await get(`https://api.github.com/repos/${REPO}/releases/assets/${sa.id}`, 'application/octet-stream');
        let b = ''; for await (const c of r) { b += c; if (b.length > 8192) break; }
        if (r.statusCode === 200) try { signature = JSON.parse(b); } catch { }
      }
      if (a && !signature) L.warn(`a release ${j.tag_name} não tem assinatura (${a.name}.sig); os apps novos vão recusá-la`);
      if (a && !(a.size > 0 && a.size <= MAX_SIZE)) throw new Error(`tamanho do instalador inválido (${a.size})`);
      const version = String(j.tag_name || '').replace(/^v/i, ''), aa = (j.assets || []).find(x => x.name === `Resenha-app-${version}.asar` && ASAR.test(x.name) && x.size > 0 && x.size <= 64 * 2 ** 20);
      const asar = aa ? { id: aa.id, name: aa.name, size: aa.size, signature: await sigOf(j, aa) } : null;
      cache = { at: Date.now(), rel: a ? { version, id: a.id, name: a.name, size: a.size, signature, asar: asar?.signature ? asar : null } : null, err: '' };
    } catch (e) {
      if (e.message !== cache.err) L.warn(`não consegui consultar o GitHub (${e.message})${token() ? '' : ' — sem chave: com o repositório privado, coloque github-token.txt na pasta de dados'}`);
      cache = { at: Date.now() - 60e3, rel: cache.rel, err: e.message }; // tenta de novo em 1 min
    }
    return cache.rel;
  }

  app.get('/api/desktop/update', async (req, res) => {
    const r = await latest().catch(() => null);
    res.set('Cache-Control', 'no-store');
    res.json(r ? { version: r.version, name: r.name, size: r.size, url: `/desktop/download/${encodeURIComponent(r.name)}`, signature: r.signature || null,
      ...(r.asar && asarOn() ? { asar: { name: r.asar.name, size: r.asar.size, url: `/desktop/download/${encodeURIComponent(r.asar.name)}`, signature: r.asar.signature } } : {}) } : {});
  });

  const pending = new Map(); // nome -> Promise (vários apps pedindo ao mesmo tempo baixam do GitHub uma vez só)
  async function fetchInstaller(r) {
    const file = path.join(dir, r.name);
    try { if (fs.statSync(file).size === r.size) return file; } catch { }
    if (!pending.has(r.name)) pending.set(r.name, (async () => {
      fs.mkdirSync(dir, { recursive: true });
      const res = await get(`https://api.github.com/repos/${REPO}/releases/assets/${r.id}`, 'application/octet-stream');
      if (res.statusCode !== 200) { res.resume(); throw new Error(`GitHub ${res.statusCode}`); }
      const tmp = file + '.part';
      // baixa para .part e só renomeia com o tamanho certo (download cortado não vira instalador servido aos apps);
      // tamanho e tempo limitados; falhou: apaga o .part
      try {
        await new Promise((ok, no) => {
          const f = fs.createWriteStream(tmp); let got = 0;
          const fail = (e) => { clearTimeout(t); res.destroy(); f.destroy(); no(e); }, t = setTimeout(() => fail(new Error('tempo esgotado')), MAX_MS);
          res.on('data', (c) => { got += c.length; if (got > r.size || got > MAX_SIZE) fail(new Error('instalador maior que o anunciado')); });
          res.pipe(f); f.on('finish', () => { clearTimeout(t); got === r.size ? ok() : no(new Error(`download incompleto (${got} de ${r.size} bytes)`)); });
          f.on('error', fail); res.on('error', fail); res.on('aborted', () => fail(new Error('download interrompido')));
        });
      } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
      fs.renameSync(tmp, file);
      for (const old of fs.readdirSync(dir)) if (old !== r.name && (SETUP.test(r.name) ? SETUP : ASAR).test(old)) fs.unlink(path.join(dir, old), () => { }); // só o mais novo fica
      return file;
    })().finally(() => pending.delete(r.name)));
    return pending.get(r.name);
  }
  app.get('/desktop/download/:name', async (req, res) => {
    const r = await latest().catch(() => null);
    const want = r && (req.params.name === r.name ? r : r.asar && asarOn() && req.params.name === r.asar.name ? r.asar : null);
    if (!want) return res.sendStatus(404);
    try {
      const file = await fetchInstaller(want);
      res.set('Cache-Control', 'no-store'); res.download(file, want.name);
    } catch (e) { L.warn('falha ao baixar o instalador', { erro: e.message }); if (!res.headersSent) res.sendStatus(502); }
  });
}
