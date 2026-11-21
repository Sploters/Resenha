// Jogar junto (participação única, kind 'play'): regras do servidor (server/remote.js) com relógio falso. Vagas (Player 2-4,
// no máximo 4 com o dono), permissões independentes e alteráveis só pelo dono, mouse para um jogador só, isolamento entre
// jogadores, convite, revogação, reconexão (resync) e saída. Compatível com os tipos antigos ('control' e 'pad').
// Uso: node scripts/remote-play-test.mjs
import { createRemote, INVITE_MS, REMOTE_PENDING_MS } from '../server/remote.js';
let fails = 0; const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
let t = 1e12, n = 0; const out = [];
const where = { h: { cid: 'v', screen: true }, a: { cid: 'v', screen: false }, b: { cid: 'v', screen: false }, c: { cid: 'v', screen: false }, d: { cid: 'v', screen: false }, x: { cid: 'outra', screen: false } };
const R = createRemote({ newId: () => 's' + ++n, now: () => t, later: () => { }, voiceOf: (u) => where[u] || null, sendUser: (u, type, d) => out.push({ u, type, d }) });
const last = (u, type, id) => out.filter(o => o.u === u && o.type === type && (!id || o.d.id === id)).at(-1)?.d;
const injected = (id) => out.filter(o => o.u === 'h' && o.type === 'REMOTE_INPUT' && o.d.id === id).flatMap(o => o.d.ev);
const G = { k: 'g', b: 1, ax: [0, 0, 0, 0], lt: 0, rt: 0 }, M = { k: 'm', x: .5, y: .5 }, K = { k: 'kd', c: 'KeyW' };
const join = (u, perms = { gamepad: true }) => { const s = R.request(u, 'h', 'play').session; R.answer('h', s.id, { accept: true, ...perms, capable: true }); return s.id; };

// ---------- pedido e aceite ----------
const pa = R.request('a', 'h', 'play').session;
ok(pa?.state === 'pending' && pa.kind === 'play' && last('h', 'REMOTE_REQUEST')?.id === pa.id, 'pedido para jogar chega ao dono');
ok(R.input('a', pa.id, [G]).sent === 0, 'antes do aceite nada passa');
ok(R.answer('a', pa.id, { accept: true, gamepad: true }).error, 'só o dono aceita');
R.answer('h', pa.id, { accept: true, gamepad: true, capable: true });
const sa = last('a', 'REMOTE_STATE', pa.id);
ok(sa.state === 'active' && sa.slot === 2 && sa.perms.gamepad && !sa.perms.mouse && !sa.perms.keyboard, 'aceito com o padrão: Player 2, só controle', sa);
ok(R.input('a', pa.id, [G, M, K]).sent === 1 && injected(pa.id).every(e => e.k === 'g'), 'sem teclado e mouse liberados: só o controle passa');

// ---------- vagas: Player 2, 3, 4 e o limite de 4 no total ----------
const ib = join('b'), ic = join('c');
ok(last('b', 'REMOTE_STATE', ib).slot === 3 && last('c', 'REMOTE_STATE', ic).slot === 4, 'próximos viram Player 3 e Player 4');
ok(/4 jogadores/.test(R.request('d', 'h', 'play').error || ''), 'com 4 no total (dono + 3), o pedido do 5º é recusado');
ok(/4 jogadores/.test(R.invite('h', 'd').error || ''), '…e o convite também');
ok(/4 jogadores/.test(R.request('d', 'h', 'pad').error || ''), '…e o pedido antigo de "jogador" (as vagas são as mesmas)');

// ---------- isolamento ----------
ok(R.input('b', pa.id, [G]).sent === 0, 'Player 3 não injeta na sessão do Player 2');
ok(R.input('x', ib, [G]).sent === 0, 'quem está fora da sala não injeta');
ok(R.setPerms('a', pa.id, { mouse: true, keyboard: true, gamepad: true }).error, 'o jogador não muda as próprias permissões');
ok(R.setPerms('b', pa.id, { mouse: true }).error, 'outro jogador não muda as permissões de ninguém');
ok(!last('a', 'REMOTE_STATE', pa.id).perms.keyboard, '…e nada mudou');

// ---------- permissões no meio da sessão ----------
R.setPerms('h', pa.id, { mouse: false, keyboard: true, gamepad: true });
ok(last('a', 'REMOTE_STATE', pa.id).perms.keyboard && last('a', 'REMOTE_STATE', pa.id).reason === 'perms', 'dono libera o teclado: o jogador é avisado na hora');
const before = injected(pa.id).length; R.input('a', pa.id, [K, M]);
ok(injected(pa.id).slice(before).map(e => e.k).join() === 'kd', 'tecla passa, mouse continua bloqueado');

// ---------- mouse: um jogador só ----------
R.setPerms('h', pa.id, { mouse: true, keyboard: true, gamepad: true });
ok(last('a', 'REMOTE_STATE', pa.id).perms.mouse, 'Player 2 com o mouse');
R.setPerms('h', ib, { mouse: true, keyboard: false, gamepad: true });
ok(last('b', 'REMOTE_STATE', ib).perms.mouse && !last('a', 'REMOTE_STATE', pa.id).perms.mouse && last('a', 'REMOTE_STATE', pa.id).reason === 'mouse_moved', 'dar o mouse ao Player 3 tira do Player 2 (e avisa)');
ok(R.input('a', pa.id, [M]).sent === 0 && R.input('b', ib, [M]).sent === 1, 'só o Player 3 move o cursor agora');
ok([...R._sessions.values()].filter(s => s.perms.mouse).length === 1, 'nunca mais de um com o mouse');

// ---------- revogar e tirar ----------
R.setPerms('h', ib, { mouse: false, keyboard: false, gamepad: false });
ok(last('b', 'REMOTE_STATE', ib).state === 'active' && R.input('b', ib, [G, M, K]).sent === 0, 'revogar tudo: continua na sessão, nada passa');
R.stop('h', ic);
ok(last('c', 'REMOTE_STATE', ic).state === 'ended' && R.input('c', ic, [G]).sent === 0, 'dono tira o Player 4: sessão acaba e nada mais passa');
ok(last('a', 'REMOTE_STATE', pa.id).state === 'active', '…os outros seguem jogando');

// ---------- convite ----------
const iv = R.invite('h', 'd', { gamepad: true }).session;
ok(iv?.invite && last('d', 'REMOTE_STATE', iv.id)?.state === 'pending' && last('d', 'REMOTE_STATE', iv.id)?.invite, 'convite chega a quem foi convidado');
ok(R.answer('h', iv.id, { accept: true, gamepad: true }).error, 'convite não é aceito pelo dono no lugar da pessoa');
ok(R.joinInvite('a', iv.id, true).error, 'outra pessoa não aceita o convite de alguém');
R.joinInvite('d', iv.id, true);
ok(last('d', 'REMOTE_STATE', iv.id).state === 'active' && last('d', 'REMOTE_STATE', iv.id).slot === 4, 'aceitou: entra na vaga livre (Player 4)');
R.stop('d', iv.id);
const iv2 = R.invite('h', 'd').session; R.joinInvite('d', iv2.id, false);
ok(last('h', 'REMOTE_STATE', iv2.id).reason === 'invite_declined', 'convite recusado: o dono fica sabendo');
const iv3 = R.invite('h', 'd').session; R.stop('h', iv3.id);
ok(last('d', 'REMOTE_STATE', iv3.id).reason === 'cancelled', 'dono cancela o convite');
const iv4 = R.invite('h', 'd').session; t += INVITE_MS + 1; R.sweep();
ok(last('d', 'REMOTE_STATE', iv4.id).reason === 'expired' && R.joinInvite('d', iv4.id, true).error, 'convite expira em 60 s');
ok(R.invite('h', 'x').error, 'não convida quem está em outra sala');
ok(R.invite('h', 'a').error, 'não convida quem já está jogando');
ok(R.invite('a', 'd').error, 'quem não transmite não convida');

// ---------- eco do painel Desempenho ----------
out.length = 0; R.echo('a', pa.id, 'ping', { t: 12.5 });
ok(last('h', 'REMOTE_PING', pa.id)?.t === 12.5, 'eco: o ping do jogador chega a quem transmite com o mesmo horário');
R.echo('h', pa.id, 'pong', { t: 12.5, h: { encMs: 4 } });
ok(last('a', 'REMOTE_PONG', pa.id)?.t === 12.5 && last('a', 'REMOTE_PONG', pa.id)?.h?.encMs === 4, 'eco: a resposta volta com o resumo de quem transmite');
ok(R.echo('b', pa.id, 'ping', { t: 1 }).dropped && R.echo('x', pa.id, 'ping', { t: 1 }).dropped, 'eco: outro jogador ou alguém de fora não usa a sessão de alguém');
R.echo('h', pa.id, 'pong', { t: 1, h: { lixo: 'x'.repeat(900) } });
ok(!last('a', 'REMOTE_PONG', pa.id)?.h || last('a', 'REMOTE_PONG', pa.id).t === 12.5, 'eco: resumo grande demais é descartado');
ok(R.echo('a', pa.id, 'ping', { t: 'x' }).dropped, 'eco: horário inválido é descartado');

// ---------- reconexão ----------
out.length = 0; R.resync('a');
ok(last('a', 'REMOTE_STATE', pa.id)?.state === 'active' && last('a', 'REMOTE_STATE', pa.id)?.slot === 2, 'reconectou: o estado da sessão volta (Player 2, mesmas permissões)');
out.length = 0; R.resync('h');
ok(out.filter(o => o.u === 'h').length === 2, 'o dono recebe o estado de todos os jogadores de novo');

// ---------- saída ----------
R.onLeave('a');
ok(last('h', 'REMOTE_STATE', pa.id).state === 'ended' && last('h', 'REMOTE_STATE', pa.id).reason === 'left', 'jogador saiu da sala (ou caiu de vez): sessão acaba');
const id5 = join('c');
ok(last('c', 'REMOTE_STATE', id5).slot === 2, 'a vaga liberada (Player 2) é reaproveitada');
const pend = R.request('d', 'h', 'play').session; t += REMOTE_PENDING_MS + 1; R.sweep();
ok(last('d', 'REMOTE_STATE', pend.id).reason === 'expired', 'pedido sem resposta expira');
R.onScreenOff('h');
ok(['b', 'c'].every(u => last(u, 'REMOTE_STATE')?.state === 'ended' && last(u, 'REMOTE_STATE')?.reason === 'stream_ended') && !R._sessions.size, 'dono parou de transmitir: todos saem');

// ---------- compatibilidade: tipos antigos ----------
const ctl = R.request('a', 'h', 'control').session; R.answer('h', ctl.id, { accept: true, mouse: true, keyboard: true, capable: true });
const pp = R.request('b', 'h', 'pad').session; R.answer('h', pp.id, { accept: true, mouse: true, gamepad: true, capable: true });
ok(last('a', 'REMOTE_STATE', ctl.id).state === 'active' && !last('a', 'REMOTE_STATE', ctl.id).slot, 'pedido antigo de controle remoto continua funcionando');
ok(last('b', 'REMOTE_STATE', pp.id).slot === 2 && !last('b', 'REMOTE_STATE', pp.id).perms.mouse, 'pedido antigo de jogador: vaga 2, nunca mouse');
const pl = R.request('c', 'h', 'play').session; R.answer('h', pl.id, { accept: true, mouse: true, gamepad: true, capable: true });
ok(last('c', 'REMOTE_STATE', pl.id).slot === 3 && last('c', 'REMOTE_STATE', pl.id).perms.mouse && !last('a', 'REMOTE_STATE', ctl.id).perms.mouse, 'mouse para o jogador novo tira também da sessão antiga de controle');
ok(R.setPerms('h', pp.id, { mouse: true }).error, 'sessão antiga de jogador não ganha mouse nem teclado');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok'); process.exit(fails ? 1 : 0);
