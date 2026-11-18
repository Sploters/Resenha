// Limites de conta e de servidor, nos mesmos números do Discord quando fazem sentido para um servidor caseiro.
// Servem para conta comprometida, app modificado ou bug em laço não encherem o banco (criar servidores, canais,
// cargos ou convites sem parar). Ninguém de uso normal chega perto deles.
// O que já tinha limite fica onde está: mensagem 4000 caracteres (server/e2ee.js), 10 anexos por mensagem,
// envio de arquivo (MAX_UPLOAD_MB), 100 emojis e 48 sons por servidor, senha de 8+ (server/accounts.js).
// Ficaram de fora: DM em grupo e notas de usuário (o Resenha não tem), registro de auditoria (guardado sem prazo:
// num servidor de amigos o histórico vale mais que o espaço), qualidade de áudio/vídeo (decidida pelo SFU e pela banda).
// Cada número pode ser trocado por variável de ambiente (LIMIT_<NOME>, ex.: LIMIT_GUILDS=200).
const env = (name, def) => { const v = Math.round(+process.env['LIMIT_' + name]); return v > 0 ? v : def; };

export const LIMITS = {
  guilds: env('GUILDS', 100),               // servidores por conta (criados + em que entrou)
  friends: env('FRIENDS', 1000),            // amigos por conta
  pendingOut: env('PENDING_OUT', 1000),     // pedidos de amizade enviados sem resposta
  blocked: env('BLOCKED', 5000),            // pessoas bloqueadas por conta
  roles: env('ROLES', 250),                 // cargos por servidor
  channels: env('CHANNELS', 500),           // canais por servidor (texto, voz, categorias…; posts de fórum não contam)
  categories: env('CATEGORIES', 50),        // categorias por servidor
  perCategory: env('PER_CATEGORY', 50),     // canais dentro de uma categoria
  invites: env('INVITES', 999),             // códigos de convite por servidor
};

// tipos de relação (tabela relationships): 1 amigo, 2 bloqueado, 3 pedido recebido, 4 pedido enviado
export function createLimits({ get }) {
  const n = (sql, ...a) => get(sql, ...a)?.n || 0;
  const rel = (uid, type) => n('SELECT COUNT(*) n FROM relationships WHERE user_id=? AND type=?', uid, type);
  const guildCount = (uid) => n('SELECT COUNT(*) n FROM members WHERE user_id=?', uid);
  return {
    // devolvem a mensagem de erro, ou null se cabe
    guildJoin: (uid) => guildCount(uid) >= LIMITS.guilds ? `Você já está em ${LIMITS.guilds} servidores (o máximo). Saia de algum para entrar ou criar outro.` : null,
    // outra pessoa seria colocada no servidor (convite para a chamada, grupo do LFG aceito pelo autor)
    guildJoinOther: (uid) => guildCount(uid) >= LIMITS.guilds ? `Essa pessoa já está em ${LIMITS.guilds} servidores (o máximo) e não pode entrar neste` : null,
    friendAdd: (uid, other) => {
      if (rel(uid, 1) >= LIMITS.friends) return `Você já tem ${LIMITS.friends} amigos (o máximo). Desfaça alguma amizade para adicionar outra.`;
      if (other && rel(other, 1) >= LIMITS.friends) return 'Essa pessoa já tem o máximo de amigos';
      return null;
    },
    friendRequest: (uid) => rel(uid, 4) >= LIMITS.pendingOut ? `Você tem ${LIMITS.pendingOut} pedidos de amizade sem resposta. Cancele alguns antes de enviar outro.` : null,
    block: (uid) => rel(uid, 2) >= LIMITS.blocked ? `Você já bloqueou ${LIMITS.blocked} pessoas (o máximo). Desbloqueie alguém para bloquear outra.` : null,
    role: (gid) => n('SELECT COUNT(*) n FROM roles WHERE guild_id=?', gid) >= LIMITS.roles ? `Limite de ${LIMITS.roles} cargos por servidor` : null,
    // canal novo (type) dentro da categoria parent (ou sem categoria)
    channel: (gid, type, parent) => {
      if (n('SELECT COUNT(*) n FROM channels WHERE guild_id=? AND type<>11', gid) >= LIMITS.channels) return `Limite de ${LIMITS.channels} canais por servidor`;
      if (type === 4 && n('SELECT COUNT(*) n FROM channels WHERE guild_id=? AND type=4', gid) >= LIMITS.categories) return `Limite de ${LIMITS.categories} categorias por servidor`;
      if (parent && type !== 4) return limitsInCategory(parent);
      return null;
    },
    inCategory: (parent) => limitsInCategory(parent),
    invite: (gid) => n('SELECT COUNT(*) n FROM invites WHERE guild_id=?', gid) >= LIMITS.invites ? `Limite de ${LIMITS.invites} convites por servidor. Apague convites antigos em Configurações do servidor › Convites.` : null,
  };
  function limitsInCategory(parent) {
    return n('SELECT COUNT(*) n FROM channels WHERE parent_id=? AND type<>11', parent) >= LIMITS.perCategory ? `Limite de ${LIMITS.perCategory} canais por categoria` : null;
  }
}
