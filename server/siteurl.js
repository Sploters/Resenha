// Endereço oficial do Resenha (ex.: https://resenha.seudominio.com.br): o que vai nos links que o app gera (convites de
// cadastro e de servidor, QR Code de login, clipes, avisos no celular), seja qual for o endereço pelo qual quem gerou
// abriu o app (IP da VPN, rede de casa, túnel provisório). O administrador define em Configurações → Administração →
// Convites de cadastro; vale na hora. Sem nada definido, vale PUBLIC_URL do ambiente e, sem ela, o endereço da página.
//   POST /api/admin/site  { public_url }  ('' apaga)   (só o administrador)

// só a origem (esquema + domínio + porta), em https (ou http para teste em localhost); null se não for um endereço válido
export function cleanOrigin(v) {
  const s = String(v || '').trim(); if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null; // outro esquema (ftp://, javascript:…)
  let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return null;
  if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null; // fora de teste, só https (microfone e câmera exigem)
  return u.origin;
}

export function createSiteUrl({ get, run }) {
  const stored = () => get("SELECT v FROM meta WHERE k='public_url'")?.v || '';
  const env = () => cleanOrigin(process.env.PUBLIC_URL) || '';
  return {
    publicUrl: () => stored() || env(),
    stored, env,
    set(v) { const o = cleanOrigin(v); if (o === null) return null; if (o) run("INSERT INTO meta(k,v) VALUES('public_url',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", o); else run("DELETE FROM meta WHERE k='public_url'"); return o; },
  };
}

export function mountSiteUrl(app, { auth, wrap, bad, run, isAdmin, site }) {
  app.post('/api/admin/site', auth, wrap((req, res) => {
    if (!isAdmin(req.uid)) return bad(res, 'Só o administrador da instalação', 403);
    const o = site.set(req.body?.public_url);
    if (o === null) return bad(res, 'Endereço inválido. Use o endereço completo com https, ex.: https://resenha.seudominio.com.br');
    try { run('INSERT INTO admin_log(at, actor_id, action, target_id, target_name, detail) VALUES(?,?,?,?,?,?)', Date.now(), req.uid, 'site_url', null, o || '(endereço da página)', null); } catch { /* tabela do admin.js */ }
    res.json({ public_url: site.publicUrl() });
  }));
}
