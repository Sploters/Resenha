// Watch Together sem navegador: adaptadores de serviço (public/watchsvc.js), lógica de sincronização
// (public/watchsync.js) e sessões do servidor (server/watch.js) com dependências simuladas.
// Cobre: propagação de comandos, Hosting/Sharing, permissões da fila, duplicados, entrada/saída, troca de anfitrião,
// reconexão, concorrência, mudança de conteúdo, fim automático, recuperação de erros.
// Uso: node scripts/watch-unit-test.mjs
import { SERVICES, parseLink, effectiveLevel, itemKey } from '../public/watchsvc.js';
import { expectedPos, createClock, decide, syncState, parseTime, fmtTime, waitingStart, TOLERANCE } from '../public/watchsync.js';
import { createWatch } from '../server/watch.js';

let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rejects = async (p, code) => { try { await p; return false; } catch (e) { return code ? e.code === code : true; } };

console.log('— adaptadores de serviço');
{
  const y = (u) => parseLink(u)?.ref;
  ok(y('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'YouTube watch?v=');
  ok(y('https://youtu.be/dQw4w9WgXcQ?t=42') === 'dQw4w9WgXcQ' && parseLink('https://youtu.be/dQw4w9WgXcQ?t=1m2s').start === 62, 'youtu.be com t= (1m2s = 62 s)');
  ok(y('https://youtube.com/shorts/dQw4w9WgXcQ') === 'dQw4w9WgXcQ' && y('https://m.youtube.com/live/dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'shorts e live');
  ok(y('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x') === 'dQw4w9WgXcQ', 'YouTube Music');
  ok(!parseLink('https://www.youtube.com/watch?v=curto') && !parseLink('javascript:alert(1)') && !parseLink('nada'), 'links inválidos recusados');
  ok(parseLink('https://www.netflix.com/watch/80100172?trackId=1')?.ref === 'watch:80100172' && parseLink('https://www.netflix.com/br/title/80057281')?.ref === 'title:80057281', 'Netflix watch/title');
  ok(parseLink('https://www.primevideo.com/detail/0KRGHGZCHKS920ZQGY5LBRF7MA/')?.service === 'prime' && parseLink('https://www.amazon.com.br/gp/video/detail/B0B6TQ9VQ1/ref=atv')?.ref === 'B0B6TQ9VQ1', 'Prime Video (primevideo e amazon gp/video)');
  ok(!parseLink('https://www.amazon.com.br/dp/B0B6TQ9VQ1'), 'produto comum da Amazon não é Prime Video');
  const c = parseLink('https://www.crunchyroll.com/pt-br/watch/GRDQPM1ZY/the-spirit-of-a-swordsman');
  ok(c?.ref === 'watch:GRDQPM1ZY' && c.title === 'The spirit of a swordsman', 'Crunchyroll episódio com título do link', c);
  ok(parseLink('/files/abc/video.mp4')?.service === 'file' && parseLink('https://x.com/a/b.webm')?.service === 'file' && !parseLink('/files/a/b.png'), 'link de vídeo (arquivo enviado e .webm)');
  ok(parseLink('http://localhost:3000/files/a/x.mp4', { origin: 'http://localhost:3000' }).ref === '/files/a/x.mp4', 'arquivo do próprio servidor vira caminho relativo');
  ok(effectiveLevel('youtube') === 'embedded' && effectiveLevel('netflix') === 'assisted' && effectiveLevel('netflix', { desktopWindow: true, widevine: false }) === 'assisted' && effectiveLevel('netflix', { desktopWindow: true, widevine: true }) === 'controls', 'nível efetivo: DRM só passa de assistido com janela + Widevine');
  ok(Object.values(SERVICES).filter(s => s.drm).every(s => s.level === 'assisted' && s.caps.embed === false), 'nenhum serviço com DRM é marcado como integrado');
}

console.log('— sincronização (lógica pura)');
{
  const pb = { status: 'playing', pos: 10, at: 1000, rate: 1 };
  ok(expectedPos(pb, 3000) === 12 && expectedPos({ ...pb, status: 'paused' }, 9000) === 10 && expectedPos(pb, 500) === 10, 'posição esperada (tocando/pausado/antes do começo)');
  ok(expectedPos(pb, 999999, 30) === 30, 'posição esperada para na duração');
  ok(waitingStart(pb, 500) && !waitingStart(pb, 1500), 'começo marcado no futuro');
  let fake = 0; const clk = createClock(() => fake);
  clk.add(0, 5100, 200); clk.add(1000, 6050, 1100); clk.add(2000, 7400, 2800);
  ok(Math.abs(clk.offset - 5000) < 1 && clk.rtt === 100, 'relógio escolhe a amostra de menor ida e volta', { off: clk.offset, rtt: clk.rtt });
  fake = 100; ok(clk.now() === 5100, 'relógio comum = local + diferença');
  let r = decide({ expected: 10, actual: 10.3, playing: true, now: 10000 });
  ok(r.action === 'none', 'dentro da tolerância: nada');
  r = decide({ expected: 10, actual: 11, playing: true, now: 10000 });
  ok(r.action === 'none' && r.strikes === 1, '1 s fora: espera confirmar na 2ª leitura');
  r = decide({ expected: 10, actual: 11, playing: true, now: 10000, strikes: 1 });
  ok(r.action === 'seek' && Math.abs(r.target - 10.25) < 1e-9, '2ª leitura fora: pula para a esperada + latência');
  r = decide({ expected: 10, actual: 15, playing: true, now: 10000 });
  ok(r.action === 'seek', 'muito longe: corrige na hora');
  r = decide({ expected: 10, actual: 15, playing: true, now: 10000, lastFix: 9000 });
  ok(r.action === 'none', 'logo depois de corrigir: espera (sem ficar pulando)');
  r = decide({ expected: 10, actual: 15, playing: true, buffering: true, now: 10000 });
  ok(r.action === 'wait', 'carregando: não corrige durante o buffer');
  r = decide({ expected: 20, actual: 21, playing: false, now: 10000, lastFix: 9900 });
  ok(r.action === 'seek' && r.target === 20, 'pausado: alinha na posição exata');
  ok(syncState({ state: 'playing', pos: 12, at: 3000 }, pb, 3000) === 'ok' && syncState({ state: 'playing', pos: 8, at: 3000 }, pb, 3000) === 'behind' && syncState({ state: 'playing', pos: 16, at: 3000 }, pb, 3000) === 'ahead' && syncState({ buffering: true }, pb, 3000) === 'buffering', 'indicador de sincronia por participante');
  ok(parseTime('1:02:03') === 3723 && parseTime('12:34') === 754 && parseTime('x') === null && fmtTime(3723) === '1:02:03' && fmtTime(65) === '1:05', 'tempo ↔ texto');
  ok(TOLERANCE <= 0.5, 'tolerância de 0,5 s');
}

console.log('— sessões no servidor');
// simulação: salas e caixas de saída por usuário
const rooms = new Map([['c1', new Set(['ana', 'beto', 'caio', 'duda'])], ['c2', new Set(['eva'])]]);
const inbox = new Map(); const sendTo = (uid, t, d) => { if (!inbox.has(uid)) inbox.set(uid, []); inbox.get(uid).push({ t, d: JSON.parse(JSON.stringify(d)) }); };
const last = (uid, t) => [...(inbox.get(uid) || [])].reverse().find(m => m.t === t)?.d;
let clock = 1_000_000; const now = () => clock;
const metaCalls = [];
const W = createWatch({
  inRoom: (uid, cid) => rooms.get(cid)?.has(uid), roomMembers: (cid) => [...(rooms.get(cid) || [])], sendTo, now, guildOf: () => 'g1',
  userPub: (id) => ({ id, display_name: id[0].toUpperCase() + id.slice(1) }),
  meta: async (it) => { metaCalls.push(it.ref); if (it.ref === 'BLOCKEDxxxx') return { embeddable: false }; if (it.ref === 'MISSINGxxxx') return { notFound: true }; return { title: 'Vídeo ' + it.ref, duration: it.ref === 'SHORTxxxxxx' ? 1 : 0 }; },
  search: async (q) => [{ service: 'youtube', ref: 'AAAAAAAAAAA', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', title: 'Resultado ' + q, duration: 100 }],
  hostGraceMs: 150, emptyGraceMs: 250, fatalSkipMs: 50,
});
const yt = (id) => `https://www.youtube.com/watch?v=${id}`;
const cmd = (uid, op, d = {}, cid = 'c1') => W.handle(uid, cid, { op, ...d });
const S = () => W._sessions.get('c1');
const tick = (ms = 200) => { clock += ms; };

ok(await rejects(cmd('eva', 'start'), 'not_in_room'), 'quem não está na sala não começa a atividade');
let st = await cmd('ana', 'start');
ok(st.host === 'ana' && st.mode === 'hosting' && st.members.length === 1, 'iniciar: quem começa é o anfitrião, modo Hosting');
ok(last('duda', 'WATCH_STATE')?.host === 'ana', 'todos da sala recebem o aviso da atividade (para entrar)');
ok(await rejects(cmd('beto', 'add', { url: yt('BBBBBBBBBBB') }), 'not_member'), 'precisa entrar na atividade antes de mexer');
await cmd('beto', 'join'); await cmd('caio', 'join');
ok(S().members.size === 3, 'entrar: 3 participantes');

// adicionar e autoplay
let r = await cmd('beto', 'add', { url: yt('BBBBBBBBBBB') });
ok(r.item.title === 'Vídeo BBBBBBBBBBB' && r.item.by === 'beto', 'adicionar por link: título pelo oEmbed e autor');
ok(S().current?.ref === 'BBBBBBBBBBB' && S().pb.status === 'playing' && S().pb.at > clock, 'primeiro item começa sozinho, com começo marcado no futuro');
ok(await rejects(cmd('caio', 'add', { url: 'https://youtu.be/BBBBBBBBBBB' }), 'duplicate'), 'duplicado (mesmo vídeo por outro link) recusado');
ok(!!(await cmd('caio', 'add', { url: 'https://youtu.be/BBBBBBBBBBB', force: true })).item, '…mas dá para forçar');
ok(await rejects(cmd('caio', 'add', { url: yt('BLOCKEDxxxx') }), 'embed_blocked'), 'vídeo que proíbe incorporação é recusado com explicação');
ok(await rejects(cmd('caio', 'add', { url: yt('MISSINGxxxx') }), 'not_found'), 'vídeo inexistente/privado recusado');
ok(await rejects(cmd('caio', 'add', { url: 'https://exemplo.com/pagina' }), 'bad_link'), 'link não reconhecido');
r = await cmd('caio', 'search', { q: 'gatos' });
ok(r.results[0]?.title === 'Resultado gatos', 'pesquisa');
await cmd('caio', 'add', { item: r.results[0] });
ok(S().queue.at(-1).duration === 100 && metaCalls.at(-1) !== 'AAAAAAAAAAA', 'adicionar pela busca usa os dados do resultado (sem oEmbed)');
await cmd('ana', 'add', { url: yt('CCCCCCCCCCC') });
const q0 = S().queue.map(x => x.ref).join();

// Hosting: permissões
const seq0 = S().pb.seq;
ok(await rejects(cmd('beto', 'pause'), 'forbidden') && S().pb.seq === seq0, 'Hosting: participante não pausa');
ok(await rejects(cmd('beto', 'seek', { pos: 30 }), 'forbidden') && await rejects(cmd('beto', 'skip'), 'forbidden'), 'Hosting: participante não muda posição nem pula');
ok(await rejects(cmd('beto', 'move', { id: S().queue[1].id, to: 0 }), 'forbidden'), 'Hosting: participante não reordena');
const anaItem = S().queue.find(x => x.by === 'ana'), caioItem = S().queue.find(x => x.by === 'caio');
ok(await rejects(cmd('caio', 'remove', { id: anaItem.id }), 'forbidden'), 'Hosting: participante não remove item dos outros');
await cmd('caio', 'remove', { id: caioItem.id });
ok(!S().queue.some(x => x.id === caioItem.id), 'Hosting: participante remove o próprio item');
tick(); await cmd('ana', 'pause', { pos: 5 });
ok(S().pb.status === 'paused' && S().pb.pos === 5 && last('beto', 'WATCH_SYNC')?.pb.status === 'paused', 'anfitrião pausa e o comando chega a todos');
ok(last('duda', 'WATCH_SYNC') === undefined, 'quem não entrou na atividade não recebe a sincronização');
tick(); await cmd('ana', 'seek', { pos: 42 });
ok(S().pb.pos === 42 && last('caio', 'WATCH_SYNC').pb.pos === 42, 'posição propagada');
tick(); await cmd('ana', 'play');
ok(S().pb.status === 'playing' && S().pb.pos === 42, 'play continua da posição combinada');

// autorizar um participante no Hosting
await cmd('ana', 'grant', { uid: 'beto', on: true });
tick(); await cmd('beto', 'pause');
ok(S().pb.status === 'paused' && S().pb.by === 'beto', 'Hosting: usuário autorizado pelo anfitrião controla');
await cmd('ana', 'grant', { uid: 'beto', on: false });
ok(await rejects(cmd('beto', 'play'), 'forbidden'), 'autorização retirada');
ok(await rejects(cmd('beto', 'mode', { mode: 'sharing' }), 'forbidden'), 'só o anfitrião muda o modo');

// Sharing
await cmd('ana', 'mode', { mode: 'sharing' });
tick(); await cmd('caio', 'play');
ok(S().pb.status === 'playing' && S().pb.by === 'caio', 'Sharing: todos controlam a reprodução');
await cmd('caio', 'add', { url: yt('DDDDDDDDDDD') });
const dd = S().queue.find(x => x.ref === 'DDDDDDDDDDD');
await cmd('beto', 'move', { id: dd.id, to: 0 });
ok(S().queue[0].id === dd.id, 'Sharing: todos reordenam');
await cmd('beto', 'remove', { id: anaItem.id });
ok(!S().queue.some(x => x.id === anaItem.id), 'Sharing: todos removem qualquer item');

// concorrência: dois comandos "ao mesmo tempo" — o servidor serializa e todos terminam no mesmo estado
tick();
const [a1, b1] = await Promise.allSettled([cmd('beto', 'seek', { pos: 70 }), cmd('caio', 'pause', { pos: 71 })]);
const fin = S().pb;
ok(a1.status === 'fulfilled' && b1.status === 'fulfilled' && fin.status === 'paused' && fin.pos === 71, 'comandos simultâneos: último a chegar vence', fin);
ok(['ana', 'beto', 'caio'].every(u => last(u, 'WATCH_SYNC').pb.seq === fin.seq), 'todos convergem para o mesmo seq');
ok(await rejects(cmd('caio', 'seek', { pos: 1 }), 'rate'), 'rajada da mesma pessoa é limitada');

// mudança de conteúdo
tick(); const before = S().current.id; await cmd('beto', 'skip');
ok(S().current.ref === 'DDDDDDDDDDD' && S().history.at(-1).id === before, 'pular: próximo da fila e o anterior vai ao histórico');
ok(last('ana', 'WATCH_STATE').current.ref === 'DDDDDDDDDDD', 'troca de conteúdo chega a todos');
tick(); const stale = await cmd('ana', 'skip', { item_id: before });
ok(stale.stale && S().current.ref === 'DDDDDDDDDDD', 'pular "duplo" (dois clicaram juntos) não pula dois vídeos');
tick(); await cmd('ana', 'prev');
ok(S().current.id === before && S().queue[0].ref === 'DDDDDDDDDDD', 'voltar ao anterior');
tick(); await cmd('ana', 'play_item', { id: S().queue[0].id });
ok(S().current.ref === 'DDDDDDDDDDD', 'tocar um item da fila');

// fim do vídeo: relatório "ended" só vale perto do fim (pelo relógio do servidor)
const curId = S().current.id;
await cmd('beto', 'meta', { item_id: curId, duration: 60 });
ok(S().current.duration === 60, 'duração descoberta pelo player é guardada');
let e = await cmd('beto', 'ended', { item_id: curId });
ok(e.stale && S().current.id === curId, '"terminou" falso (fora do fim) é ignorado');
clock += 60_000;
e = await cmd('caio', 'ended', { item_id: curId });
ok(!e.stale && S().current?.id !== curId, 'perto do fim: vai para o próximo');
// temporizador do servidor (sem ninguém relatar)
st = S(); const qlen = st.queue.length;
await cmd('ana', 'add', { url: yt('SHORTxxxxxx') }); // meta diz duração 1 s
while (S().current && S().current.ref !== 'SHORTxxxxxx') { tick(); await cmd('ana', 'skip'); }
ok(S().current?.ref === 'SHORTxxxxxx', 'vídeo de 1 s tocando', qlen);
clock += 5000; await sleep(1000 + 1500 + 1500 + 400);
ok(S().current === null && S().pb.status === 'idle', 'fim pela duração (temporizador do servidor) sem relatório: fila acaba → parado');

// erros: todos com erro fatal → pula sozinho; só um com erro → só ele vê
await cmd('ana', 'add', { url: yt('EEEEEEEEEEE') }); await cmd('ana', 'add', { url: yt('FFFFFFFFFFF') });
const ee = S().current.id;
await cmd('ana', 'report', { item_id: ee, error: 'region', state: 'idle' });
await sleep(80); ok(S().current.id === ee, 'erro não fatal (região) de um participante não pula para todos');
for (const u of ['ana', 'beto', 'caio']) await cmd(u, 'report', { item_id: ee, error: 'embed_blocked', state: 'idle' });
ok(/não pode tocar/.test(last('beto', 'WATCH_STATE').notice || ''), 'todos com incorporação bloqueada: aviso explicando');
await sleep(120);
ok(S().current.ref === 'FFFFFFFFFFF', '…e pula para o próximo sozinho');
await cmd('caio', 'report', { item_id: S().current.id, buffering: true, state: 'playing', pos: 3 });
await sleep(800);
const rep = last('ana', 'WATCH_MEMBERS');
ok(rep && rep.reports.caio?.buffering === true && rep.reports.beto?.online === true, 'relatórios de cada participante chegam a todos (indicador)', rep);

// queda e reconexão
await cmd('ana', 'mode', { mode: 'hosting' });
W.onVoiceLeave('beto', 'c1', 'drop');
ok(S().members.get('beto').online === false && S().members.has('beto'), 'queda: participante fica offline, sem sair da sessão');
inbox.set('beto', []);
W.onVoiceJoin('beto', 'c1');
ok(S().members.get('beto').online && last('beto', 'WATCH_STATE')?.current?.ref === 'FFFFFFFFFFF', 'reconexão: volta sozinho e recebe o estado (vídeo, posição)');
// entrada tardia
rooms.get('c1').add('fabi'); W.onVoiceJoin('fabi', 'c1');
ok(last('fabi', 'WATCH_STATE')?.pb && !S().members.has('fabi'), 'quem chega depois vê a atividade e escolhe entrar');
st = await cmd('fabi', 'join');
ok(st.current.ref === 'FFFFFFFFFFF' && typeof st.pb.pos === 'number' && st.now === clock, 'entrada tardia recebe posição + relógio para alcançar');

// anfitrião cai e volta dentro do prazo: continua anfitrião
W.onVoiceLeave('ana', 'c1', 'drop'); await sleep(60); W.onVoiceJoin('ana', 'c1'); await sleep(150);
ok(S().host === 'ana', 'anfitrião que cai e volta logo continua anfitrião');
// anfitrião cai e não volta: passa para quem está há mais tempo (beto entrou antes de caio)
W.onVoiceLeave('ana', 'c1', 'drop'); await sleep(220);
ok(S().host === 'beto' && /agora é o anfitrião/.test(last('caio', 'WATCH_STATE').notice || ''), 'anfitrião que não volta: o mais antigo vira anfitrião (com aviso)');
W.onVoiceJoin('ana', 'c1');
ok(S().host === 'beto' && S().members.get('ana').online, 'antigo anfitrião volta como participante');
// passar o anfitrião
await cmd('beto', 'host', { uid: 'caio' });
ok(S().host === 'caio', 'anfitrião passa o controle para outra pessoa');
// saída explícita do anfitrião
await cmd('caio', 'leave');
ok(S().host !== 'caio' && !S().members.has('caio'), 'anfitrião que sai: troca imediata');
// sair da sala de voz (sem queda) = sair da atividade
W.onVoiceLeave('fabi', 'c1');
ok(!S().members.has('fabi'), 'sair da chamada tira da atividade');
ok(await rejects(cmd([...S().members.keys()].find(u => u !== S().host), 'end'), 'forbidden'), 'só o anfitrião encerra para todos');

// sessão vazia termina depois do prazo; voltar antes mantém
const host = S().host;
for (const u of [...S().members.keys()]) W.onVoiceLeave(u, 'c1', 'drop');
ok(!!S(), 'todos caíram: a sessão espera');
W.onVoiceJoin(host, 'c1'); await sleep(300);
ok(!!S() && S().members.get(host).online, 'alguém voltou no prazo: sessão continua');
for (const u of [...S().members.keys()]) W.onVoiceLeave(u, 'c1', 'drop');
await sleep(320);
ok(!S() && last('duda', 'WATCH_END')?.reason === 'empty', 'ninguém voltou: sessão termina e a sala é avisada');

// serviço assistido: começa pausado e o play vem com contagem
await cmd('ana', 'start'); await cmd('beto', 'join');
await cmd('ana', 'add', { url: 'https://www.netflix.com/watch/80100172', title: 'Episódio 1' });
ok(S().current.service === 'netflix' && S().pb.status === 'paused', 'Netflix (assistido): começa pausado esperando todos abrirem');
tick(); await cmd('ana', 'play');
ok(S().pb.status === 'playing' && S().pb.at - clock === 3000, 'play assistido com contagem de 3 s');
await cmd('beto', 'report', { item_id: S().current.id, external: true, ready: true, state: 'paused', pos: 0 });
await sleep(800);
ok(last('ana', 'WATCH_MEMBERS').reports.beto.ready === true, '"estou pronto" chega ao anfitrião');
await cmd('ana', 'end');
ok(!S() && last('beto', 'WATCH_END')?.reason === 'host_ended', 'anfitrião encerra para todos');
ok(itemKey({ service: 'youtube', ref: 'x' }) === 'youtube:x', 'chave de duplicado');

console.log(`\n${n - fails}/${n} verificações ok`);
process.exit(fails ? 1 : 0);
