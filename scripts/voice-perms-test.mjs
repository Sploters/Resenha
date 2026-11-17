// Permissões Falar e Vídeo por sala (como as do Discord: Conectar, Falar, Vídeo). Sem Falar: entra, mas o estado de voz
// vem com no_speak (o SFU pausa o microfone); sem Vídeo: no_video e o servidor recusa produzir câmera/tela. Mudar o ajuste
// com a pessoa na sala vale na hora; cargo com "Gerenciar canais" passa por cima.
// Uso: node scripts/voice-perms-test.mjs (sobe um servidor próprio) ou BASE=http://localhost:3111 node scripts/voice-perms-test.mjs
import { ownServer } from './test-server.mjs';
import WebSocket from 'ws';
const BASE = process.env.BASE || await ownServer('voiceperms', 3347, 41380);
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
const CH = { CONNECT: 8, SPEAK: 16, VIDEO: 32 };

const own = await user('dono'), mem = await user('membro');
const g = (await call(own.tok, 'POST', '/guilds', { name: 'Perms' })).data;
const gc = await own.gw.wait('GUILD_CREATE');
const inv = (await call(own.tok, 'POST', `/guilds/${g.id}/invites`)).data;
await call(mem.tok, 'POST', `/invites/${inv.code}`); await mem.gw.wait('GUILD_CREATE');
const v1 = gc.channels.find(c => c.type === 2);
const setPerms = (deny) => call(own.tok, 'PUT', `/channels/${v1.id}/perms`, { overwrites: deny ? [{ target: 'everyone', allow: 0, deny }] : [] });
const vstate = (u, uid, f) => u.gw.wait('VOICE_STATE', d => d.user_id === uid && (!f || f(d)));

// entrar já sem Falar e sem Vídeo
ok((await setPerms(CH.SPEAK | CH.VIDEO)).status === 200, 'dono nega Falar e Vídeo para @everyone na sala');
let s = vstate(mem, mem.id, d => d.channel_id === v1.id);
mem.gw.send('VOICE_JOIN', { channel_id: v1.id });
const st = await s.catch(() => null);
ok(st?.no_speak === true && st?.no_video === true, 'membro entra (Conectar continua liberado) com no_speak e no_video', st);
// estado de vídeo do cliente é ignorado sem a permissão
s = vstate(own, mem.id, d => d.channel_id === v1.id);
mem.gw.send('VOICE_STATE', { mute: false, deaf: false, video: true, screen: true });
const st2 = await s.catch(() => null);
ok(st2 && !st2.video && !st2.screen, 'servidor não aceita "câmera ligada" de quem não tem Vídeo', st2);

// devolver as permissões com a pessoa na sala: vale na hora
s = vstate(mem, mem.id, d => d.channel_id === v1.id && !d.no_speak && !d.no_video);
await setPerms(0);
ok(!!(await s.catch(() => null)), 'liberar Falar e Vídeo chega na hora para quem está na sala');
s = vstate(mem, mem.id, d => d.channel_id === v1.id && d.no_speak === true && !d.no_video);
await setPerms(CH.SPEAK);
ok(!!(await s.catch(() => null)), 'tirar só Falar no meio da chamada: no_speak sem no_video');

// cargo com Gerenciar canais passa por cima
const r = (await call(own.tok, 'POST', `/guilds/${g.id}/roles`, { name: 'Staff', perms: 4 })).data.id;
s = vstate(mem, mem.id, d => d.channel_id === v1.id && !d.no_speak);
await call(own.tok, 'PATCH', `/guilds/${g.id}/members/${mem.id}`, { roles: [r] });
ok(!!(await s.catch(() => null)), 'ganhar cargo com "Gerenciar canais" libera Falar na hora');

// o dono nunca é barrado
s = vstate(own, own.id, d => d.channel_id === v1.id);
own.gw.send('VOICE_JOIN', { channel_id: v1.id });
const so = await s.catch(() => null);
ok(so && !so.no_speak && !so.no_video, 'dono entra sem restrição', so);

console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
for (const u of [own, mem]) u.gw.ws.close();
process.exit(fails ? 1 : 0);
