// Permissões por canal e por categoria (ideia: "Category permissions + settings", Stoat #1010).
// Cada canal ou categoria guarda ajustes por cargo (ou para @everyone, alvo 'everyone'): permitir ou negar cada ação.
// Um canal dentro de uma categoria nasce SINCRONIZADO (channels.perm_sync = 1): usa os ajustes da categoria, ao vivo —
// mudar a categoria muda todos os canais sincronizados de uma vez. Ajustar o próprio canal tira a sincronia (copia os da
// categoria e muda só ele); "Sincronizar com a categoria" volta a herdar.
// Conta como em qualquer servidor: dono, administrador e quem gerencia canais nunca são barrados. Ordem: tudo liberado →
// @everyone (nega, depois permite) → cargos da pessoa (soma o que todos negam, depois soma o que algum permite: o permitir
// de um cargo vence o negar de outro). Ver o canal continua livre para todo membro (canais privados ainda não existem).
// SPEAK e VIDEO (como no Discord: Conectar, Falar e Vídeo): sem Falar a pessoa entra na sala, mas o servidor não repassa a
// voz dela; sem Vídeo não liga câmera nem transmite a tela. Ajustes gravados antes destes bits continuam valendo (liberados).
export const CH = { SEND: 1, ATTACH: 2, REACT: 4, CONNECT: 8, SPEAK: 16, VIDEO: 32 };
export const CH_ALL = 63;

export function createChPerms({ db, all, get, run, memberPerms, P }) {
  try { db.exec('ALTER TABLE channels ADD COLUMN perm_sync INTEGER DEFAULT 1'); } catch { /* já existe */ }
  db.exec(`CREATE TABLE IF NOT EXISTS channel_perms(channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, target TEXT NOT NULL,
    allow INTEGER NOT NULL DEFAULT 0, deny INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(channel_id, target));`);

  // canal cujos ajustes valem: post de fórum (11) segue o fórum; sincronizado dentro de categoria segue a categoria
  function source(ch) {
    if (!ch) return null;
    if (ch.type === 11 && ch.parent_id) ch = get('SELECT * FROM channels WHERE id=?', ch.parent_id) || ch;
    if (ch.type !== 4 && ch.parent_id && ch.perm_sync !== 0) { const cat = get('SELECT * FROM channels WHERE id=? AND type=4', ch.parent_id); if (cat) return cat; }
    return ch;
  }
  const overwrites = (cid) => all('SELECT target, allow, deny FROM channel_perms WHERE channel_id=?', cid);

  // bits que a pessoa tem neste canal (CH_ALL = sem restrição)
  function chPerms(ch, uid) {
    if (!ch?.guild_id) return CH_ALL; // DM e grupo: sem cargos
    const gp = memberPerms(ch.guild_id, uid);
    if (gp & (P.ADMIN | P.MANAGE_CHANNELS)) return CH_ALL;
    // anúncios (5) e documento (17): por padrão só quem gerencia mensagens escreve; os ajustes do canal podem liberar
    const base = (ch.type === 5 || ch.type === 17) && !(gp & P.MANAGE_MESSAGES) ? CH_ALL & ~(CH.SEND | CH.ATTACH) : CH_ALL;
    const src = source(ch), ows = overwrites(src.id);
    if (!ows.length) return base;
    let p = base;
    const ev = ows.find(o => o.target === 'everyone');
    if (ev) p = (p & ~ev.deny) | ev.allow;
    const mine = new Set(all('SELECT role_id FROM member_roles WHERE guild_id=? AND user_id=?', ch.guild_id, uid).map(r => r.role_id));
    let a = 0, d = 0;
    for (const o of ows) if (mine.has(o.target)) { a |= o.allow; d |= o.deny; }
    return ((p & ~d) | a) & CH_ALL;
  }
  const chCan = (ch, uid, bit) => (chPerms(ch, uid) & bit) !== 0;

  // grava os ajustes de um canal (lista completa: o que não vem é apagado). Só cargos do servidor e 'everyone'.
  function setOverwrites(ch, list) {
    const valid = new Set(all('SELECT id FROM roles WHERE guild_id=?', ch.guild_id).map(r => r.id)); valid.add('everyone');
    db.exec('BEGIN');
    try {
      run('DELETE FROM channel_perms WHERE channel_id=?', ch.id);
      for (const o of (Array.isArray(list) ? list : []).slice(0, 100)) {
        const t = String(o?.target || ''), allow = (+o?.allow | 0) & CH_ALL, deny = (+o?.deny | 0) & CH_ALL & ~allow;
        if (valid.has(t) && (allow || deny)) run('INSERT OR REPLACE INTO channel_perms VALUES(?,?,?,?)', ch.id, t, allow, deny);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  // o mesmo, dentro de uma transação que já está aberta (importar a estrutura do Discord: server/discordimport.js)
  function setOverwritesNoTx(chId, gid, list) {
    const valid = new Set(all('SELECT id FROM roles WHERE guild_id=?', gid).map(r => r.id)); valid.add('everyone');
    run('DELETE FROM channel_perms WHERE channel_id=?', chId);
    for (const o of list.slice(0, 100)) {
      const t = String(o?.target || ''), allow = (+o?.allow | 0) & CH_ALL, deny = (+o?.deny | 0) & CH_ALL & ~allow;
      if (valid.has(t) && (allow || deny)) run('INSERT OR REPLACE INTO channel_perms VALUES(?,?,?,?)', chId, t, allow, deny);
    }
  }
  function copyOverwrites(fromId, toId) { for (const o of overwrites(fromId)) run('INSERT OR REPLACE INTO channel_perms VALUES(?,?,?,?)', toId, o.target, o.allow, o.deny); }
  // tudo de um servidor, para a abertura do app: { canal: [ajustes] }
  function guildOverwrites(gid) {
    const out = {};
    for (const r of all('SELECT cp.channel_id, cp.target, cp.allow, cp.deny FROM channel_perms cp JOIN channels c ON c.id=cp.channel_id WHERE c.guild_id=?', gid))
      (out[r.channel_id] ||= []).push({ target: r.target, allow: r.allow, deny: r.deny });
    return out;
  }
  return { CH, CH_ALL, chPerms, chCan, source, overwrites, setOverwrites, setOverwritesNoTx, copyOverwrites, guildOverwrites };
}
