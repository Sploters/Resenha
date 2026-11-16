// Moderação de voz (PATCH /api/guilds/:id/voice/:uid): mutar/ensurdecer para o servidor (continua ao sair e voltar),
// mover para outra sala e desconectar, sempre respeitando a hierarquia de cargos e a permissão "Moderar voz".
// Uso: node scripts/voice-mod-test.mjs (sobe um servidor próprio) ou BASE=http://localhost:3111 node scripts/voice-mod-test.mjs
import { ownServer } from './test-server.mjs';
import WebSocket from 'ws';
const BASE = process.env.BASE || await ownServer('voicemod', 3345, 41360);
let fails = 0;
const ok = (c, msg, extra) => { console.log((c ? '  ok   ' : '  FAIL ') + msg + (!c && extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!c) fails++; };
const call = async (tok, method, path, body) => {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
function gateway(tok) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/gateway?token=' + tok), q = [], waiters = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); const i = waiters.findIndex(w => w.t === m.t && (!w.f || w.f(m.d))); if (i >= 0) waiters.splice(i, 1)[0].res(m.d); else q.push(m); });
  return {
    ws, send: (t, d) => ws.send(JSON.stringify({ t, d })),
    wait: (t, f, ms = 4000) => new Promise((res, rej) => { const i = q.findIndex(m => m.t === t && (!f || f(m.d))); if (i >= 0) return res(q.splice(i, 1)[0].d); const w = { t, f, res }; waiters.push(w); setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error('timeout ' + t)); } }, ms); }),
  };
}
const sfx = Math.random().toString(36).slice(2, 7);
async function user(name) {
  const tok = (await call('', 'POST', '/register', { username: name + sfx, password: 'Teste.senha-123' })).data.token;
  const gw = gateway(tok), ready = await gw.wait('READY');
  return { tok, gw, id: ready.user.id };
}
const P = { KICK: 16, MANAGE_ROLES: 64, VOICE_MOD: 512 };

const own = await user('dono'), mod = await user('mod'), adm = await user('admin'), mem = await user('membro');
const g = (await call(own.tok, 'POST', '/guilds', { name: 'Voz' })).data;
const gc = await own.gw.wait('GUILD_CREATE');
const inv = (await call(own.tok, 'POST', `/guilds/${g.id}/invites`)).data;
for (const u of [mod, adm, mem]) { await call(u.tok, 'POST', `/invites/${inv.code}`); await u.gw.wait('GUILD_CREATE'); }
const v1 = gc.channels.find(c => c.type === 2);
const v2 = (await call(own.tok, 'POST', `/guilds/${g.id}/channels`, { name: 'Sala 2', type: 2 })).data;
const rMod = (await call(own.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Mod', perms: P.VOICE_MOD })).data.id;
const rAdm = (await call(own.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Admin', perms: 1 })).data.id;
await call(own.tok, 'PUT', `/guilds/${g.id}/roles/order`, { ids: [rAdm, rMod] });
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${mod.id}`, { roles: [rMod] });
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${adm.id}`, { roles: [rAdm] });

const vstate = (u, uid, f) => u.gw.wait('VOICE_STATE', d => d.user_id === uid && (!f || f(d)));
const join = async (u, cid) => { const w = vstate(u, u.id, d => d.channel_id === cid); u.gw.send('VOICE_JOIN', { channel_id: cid }); return w; };
await join(mem, v1.id); await join(adm, v1.id);
const vm = (tok, uid, body) => call(tok, 'PATCH', `/guilds/${g.id}/voice/${uid}`, body);

// permissão e hierarquia
ok((await vm(mem.tok, adm.id, { mute: true })).status === 403, 'membro sem "Moderar voz" não muta ninguém');
ok((await vm(mod.tok, adm.id, { mute: true })).status === 403, 'mod não muta admin (cargo acima)');
ok((await vm(mod.tok, own.id, { disconnect: true })).status === 403, 'mod não desconecta o dono');

// mutar e ensurdecer
let s = vstate(mem, mem.id, d => d.mod_mute === true);
ok((await vm(mod.tok, mem.id, { mute: true })).status === 200, 'mod muta membro');
ok(!!(await s.catch(() => null)), 'estado de voz chega com mod_mute para o próprio membro');
s = vstate(adm, mem.id, d => d.mod_deaf === true && d.mod_mute === true);
await vm(mod.tok, mem.id, { deaf: true });
ok(!!(await s.catch(() => null)), 'os outros da sala veem mod_mute e mod_deaf');
// sair e voltar: continua mutado
const left = vstate(mem, mem.id, d => !d.channel_id); mem.gw.send('VOICE_LEAVE', {}); await left.catch(() => null);
const back = await join(mem, v1.id).catch(() => null);
ok(back?.mod_mute === true && back?.mod_deaf === true, 'continua mutado e ensurdecido ao sair e voltar', back);
s = vstate(mem, mem.id, d => !d.mod_mute && !d.mod_deaf);
await vm(mod.tok, mem.id, { mute: false, deaf: false });
ok(!!(await s.catch(() => null)), 'mod tira o mudo e o ensurdecer');

// mover
const mv = mem.gw.wait('VOICE_MODERATED', d => d.action === 'move');
ok((await vm(mod.tok, mem.id, { channel_id: v2.id })).status === 200, 'mod move membro para a Sala 2');
const mvd = await mv.catch(() => null);
ok(mvd?.channel_id === v2.id && mvd?.from === v1.id && mvd?.by === mod.id, 'membro recebe o pedido de mudar de sala', mvd);
ok((await vm(mod.tok, mem.id, { channel_id: 'nada' })).status === 400, 'sala inexistente é recusada');

// desconectar
const dc = mem.gw.wait('VOICE_MODERATED', d => d.action === 'disconnect'), gone = vstate(adm, mem.id, d => !d.channel_id && d.reason === 'kicked');
ok((await vm(mod.tok, mem.id, { disconnect: true })).status === 200, 'mod desconecta membro');
ok(!!(await dc.catch(() => null)), 'membro é avisado');
ok((await gone.catch(() => null))?.reason === 'kicked', 'membro sai da sala para todos (motivo "kicked")');
ok((await vm(mod.tok, mem.id, { disconnect: true })).status === 409, 'desconectar quem não está em sala dá 409');

// auditoria
const aud = (await call(own.tok, 'GET', `/guilds/${g.id}/audit`)).data.entries.map(e => e.action);
ok(['voice_mute', 'voice_deaf', 'voice_unmute', 'voice_undeaf', 'voice_move', 'voice_disconnect'].every(a => aud.includes(a)), 'registro de auditoria: ' + [...new Set(aud.filter(a => a.startsWith('voice_')))].join(' '));

console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
for (const u of [own, mod, adm, mem]) u.gw.ws.close();
process.exit(fails ? 1 : 0);
