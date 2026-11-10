// Bot de música embutido (inspirado no Jockie Music do Discord): entra na sala de voz como um participante e toca
// links ou buscas (YouTube, SoundCloud, Spotify, Bandcamp…) numa fila.
// Áudio: yt-dlp (extração, sem anúncios) -> ffmpeg (Opus/RTP) -> PlainTransport do mediasoup -> aparece
// como o microfone do bot.
// Recursos: até MUSIC_BOTS bots por servidor (um por sala, como Jockie Music 1–4), buscar e escolher entre os
// resultados, tocar agora / a seguir / no fim, pular, voltar, repetir (faixa ou fila), embaralhar, mover e remover da
// fila, pular para um ponto (seek), reprodução automática de músicas parecidas quando a fila acaba, modo 24/7,
// histórico e playlists salvas no servidor.
// YouTube: desde 2025 exige resolver um desafio em JavaScript; o yt-dlp precisa de um runtime (usamos o próprio Node)
// e do script "EJS" (já embutido no yt-dlp_linux da imagem Docker; senão, --remote-components baixa do GitHub).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import https from 'node:https';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const COOKIES = process.env.YTDLP_COOKIES || '';
const REMOTE_EJS = process.env.YTDLP_REMOTE_EJS !== '0'; // baixa o script do desafio do YouTube se o yt-dlp não tiver embutido
const IDLE_MS = Math.max(1, Number(process.env.MUSIC_IDLE_MIN || 5)) * 60_000;
const ALONE_MS = 20_000; // sem humanos na sala
const MAX_QUEUE = 300, MAX_PLAYLIST = 100, MAX_HISTORY = 30;
const MAX_BOTS = Math.max(1, Math.min(8, Number(process.env.MUSIC_BOTS || 4)));
const ALLOW_ANY = process.env.MUSIC_ALLOW_ANY === '1';
const HOSTS = ['youtube.com', 'youtu.be', 'music.youtube.com', 'soundcloud.com', 'spotify.com', 'bandcamp.com', 'twitch.tv', 'vimeo.com', 'dailymotion.com', 'mixcloud.com', 'deezer.com', 'audiomack.com'];
const BOT_PREFIX = 'bot_music_';
const LOOPS = ['off', 'track', 'queue'];

const sessions = new Map(); // channelId -> sessão (um bot por sala; vários bots por servidor)
let env = null, available = null;

export const initMusic = (e) => {
  env = e;
  env.db?.exec(`CREATE TABLE IF NOT EXISTS music_playlists(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL, tracks TEXT NOT NULL, by_id TEXT, created_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_music_pl_guild ON music_playlists(guild_id, name);`);
};
export const isMusicBot = (uid) => !!env.get('SELECT 1 x FROM users WHERE id=? AND username LIKE ?', uid, BOT_PREFIX + '%');

// ---------- binários ----------
function probeBins() {
  return new Promise((resolve) => {
    const check = (bin, arg) => new Promise(r => { try { const p = spawn(bin, [arg], { stdio: 'ignore' }); p.on('error', () => r(false)); p.on('exit', c => r(c === 0)); } catch { r(false); } });
    Promise.all([check(YTDLP, '--version'), check(FFMPEG, '-version')]).then(([y, f]) => resolve(y && f));
  });
}
export async function musicAvailable() { if (available === null) available = await probeBins(); return available; }

// ---------- resolução de links / buscas ----------
const hostOk = (u) => {
  if (ALLOW_ANY) return true;
  const h = u.hostname.toLowerCase();
  return HOSTS.some(d => h === d || h.endsWith('.' + d));
};
const ytdlpArgs = (extra) => ['--ignore-config', '--no-warnings', '--js-runtimes', 'node', ...(REMOTE_EJS ? ['--remote-components', 'ejs:github'] : []), ...(COOKIES ? ['--cookies', COOKIES] : []), ...extra];
const ytErr = (err) => (/Sign in|confirm you.re not a bot|cookies/i.test(err) ? 'o YouTube pediu login (configure YTDLP_COOKIES, veja o README)'
  : /HTTP Error 403|Requested format is not available|n challenge|Signature solving/i.test(err) ? 'o YouTube bloqueou o download (atualize o yt-dlp: refaça o deploy)'
  : (err.split('\n').filter(l => /ERROR/.test(l)).pop() || err.split('\n').filter(Boolean).pop() || 'não foi possível abrir esse link').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 160));

function runJson(args, timeout = 45_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, ytdlpArgs(args), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('A busca demorou demais')); }, timeout);
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('error', () => { clearTimeout(t); reject(new Error('yt-dlp não está instalado no servidor')); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(ytErr(err)));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Resposta inválida do yt-dlp')); }
    });
  });
}
const trackFrom = (e, fallbackUrl) => ({
  title: String(e.track || e.title || 'Sem título').slice(0, 140),
  artist: String(e.artist || e.uploader || e.channel || '').replace(/VEVO$|\s+-\s+Topic$/i, '').slice(0, 80),
  duration: Math.round(+e.duration || 0),
  thumb: e.thumbnail || e.thumbnails?.[e.thumbnails.length - 1]?.url || (e.id && /youtube/.test(e.ie_key || e.extractor || '') ? `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg` : null),
  url: e.webpage_url || (e.ie_key === 'Youtube' && e.id ? `https://www.youtube.com/watch?v=${e.id}` : e.url) || fallbackUrl,
});

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'accept-language': 'en', ...headers }, timeout: 10_000 }, (res) => {
      if (res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let b = ''; res.setEncoding('utf8'); res.on('data', d => (b += d)); res.on('end', () => resolve(b));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}
// Spotify não entrega áudio: lê os nomes das faixas (página de embed) e procura no YouTube na hora de tocar
async function spotifyTracks(u) {
  const m = u.pathname.match(/\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Link do Spotify não reconhecido');
  const html = await fetchText(`https://open.spotify.com/embed/${m[1]}/${m[2]}`);
  const j = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!j) throw new Error('Não consegui ler esse link do Spotify');
  const ent = JSON.parse(j)?.props?.pageProps?.state?.data?.entity;
  if (!ent) throw new Error('Não consegui ler esse link do Spotify');
  const list = Array.isArray(ent.trackList) && ent.trackList.length ? ent.trackList.map(t => ({ title: t.title, artist: t.subtitle || '', duration: Math.round((+t.duration || 0) / 1000) }))
    : [{ title: ent.name || ent.title, artist: (ent.artists || []).map(a => a.name).join(', ') || ent.subtitle || '', duration: Math.round((+ent.duration || 0) / 1000) }];
  return list.filter(t => t.title).slice(0, MAX_PLAYLIST).map(t => ({
    title: String(t.title).slice(0, 140), artist: String(t.artist).replace(/ /g, ' ').slice(0, 80), duration: t.duration || 0, thumb: ent.coverArt?.sources?.[0]?.url || null,
    search: `ytsearch1:${t.artist ? t.artist + ' - ' : ''}${t.title}`.slice(0, 200), url: null,
  }));
}

// busca por texto: até `n` resultados (rápido: sem abrir cada vídeo)
export async function searchTracks(q, n = 5) {
  q = String(q || '').trim().slice(0, 300); if (!q) throw new Error('Digite o nome da música');
  const j = await runJson(['-J', '--flat-playlist', '--', `ytsearch${n}:${q}`]);
  const list = (j.entries || []).filter(Boolean).map(e => trackFrom(e)).filter(t => t.url);
  if (!list.length) throw new Error('Nada encontrado');
  return list;
}
// Devolve uma lista de faixas { title, artist, duration, thumb, url | search }
export async function resolveQuery(q) {
  q = String(q || '').trim().slice(0, 500);
  if (!q) throw new Error('Digite um link ou o nome da música');
  let u = null;
  if (/^https?:\/\//i.test(q)) { try { u = new URL(q); } catch { throw new Error('Link inválido'); } }
  if (!u) return (await searchTracks(q, 1)).slice(0, 1);
  if (!hostOk(u)) throw new Error('Site não permitido (YouTube, SoundCloud, Spotify, Bandcamp, Twitch, Vimeo...)');
  if (/(^|\.)spotify\.com$/.test(u.hostname)) return spotifyTracks(u);
  // link de vídeo dentro de uma playlist/mix do YouTube: toca só o vídeo (a playlist inteira só com o link da playlist)
  const single = /youtube\.com$|youtu\.be$/.test(u.hostname.replace(/^www\.|^music\./, '')) && (u.searchParams.has('v') || u.hostname.endsWith('youtu.be'));
  const j = await runJson(['-J', ...(single ? ['--no-playlist'] : ['--flat-playlist', '--playlist-end', String(MAX_PLAYLIST)]), '--', u.href]);
  if (j.entries) {
    const list = j.entries.filter(Boolean).map(e => trackFrom(e)).filter(t => t.url);
    if (!list.length) throw new Error('Playlist vazia');
    return list;
  }
  return [trackFrom(j, u.href)];
}

// ---------- sessão ----------
const isHuman = (uid) => !isMusicBot(uid);
const humansIn = (cid) => [...(env.voice.get(cid)?.keys() || [])].filter(isHuman);
const pub = (t) => t && ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, thumb: t.thumb, by: t.by, url: t.url, auto: !!t.auto });
const elapsedOf = (s) => (!s.current ? 0 : s.paused ? s.pos.base : s.pos.base + (Date.now() - s.pos.at));
const view = (s) => ({
  channel_id: s.channelId, guild_id: s.guildId, bot_id: s.botId, bot_n: s.n, active: true, paused: s.paused, loading: !!s.loading,
  elapsed: Math.round(elapsedOf(s)), loop: s.loop, autoplay: s.autoplay, stay: s.stay,
  current: pub(s.current), queue: s.queue.map(pub), history: s.history.slice(-MAX_HISTORY).reverse().map(pub),
});

function push(s, extra = {}) {
  const payload = { ...view(s), ...extra };
  for (const [uid, st] of env.voice.get(s.channelId) || []) if (isHuman(uid)) env.send(st.ws, 'MUSIC_STATE', payload);
}
export function onVoiceJoin(cid, ws) { // alguém entrou numa sala onde o bot está
  const s = sessions.get(cid);
  if (s) { env.send(ws, 'MUSIC_STATE', view(s)); clearTimeout(s.aloneTimer); }
  else env.send(ws, 'MUSIC_STATE', { channel_id: cid, active: false });
}
export function onVoiceLeave(cid) { // alguém saiu: se só sobrou o bot, ele sai também (menos no modo 24/7)
  const s = sessions.get(cid);
  if (s && !env.voice.get(cid)?.has(s.botId)) { clearTimeout(s.idleTimer); clearTimeout(s.aloneTimer); killProc(s); sessions.delete(cid); return; } // bot removido da sala (canal apagado etc.)
  if (!s || s.stay || humansIn(cid).length) return;
  clearTimeout(s.aloneTimer); s.aloneTimer = setTimeout(() => { if (!humansIn(s.channelId).length && !s.stay) endSession(s, 'Todos saíram da sala'); }, ALONE_MS);
}

// bot n (1..MAX_BOTS) do servidor: "Música", "Música 2"… (o 1 mantém o nome de usuário antigo)
function botUserFor(gid, n) {
  const uname = BOT_PREFIX + gid + (n > 1 ? '_' + n : '');
  let u = env.get('SELECT id FROM users WHERE username=?', uname);
  if (!u) {
    const id = env.newId(), salt = crypto.randomBytes(16).toString('hex');
    env.run('INSERT INTO users(id,username,display_name,pass_hash,salt,color,avatar,bio,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      id, uname, n > 1 ? `Música ${n}` : 'Música', crypto.randomBytes(32).toString('hex'), salt, ['#a855f7', '#22c55e', '#f97316', '#0ea5e9', '#e11d48', '#eab308', '#14b8a6', '#6366f1'][(n - 1) % 8], null, 'Bot de música do servidor', Date.now());
    u = { id };
  }
  return u.id;
}

async function startSession(guildId, channelId) {
  const used = new Set([...sessions.values()].filter(x => x.guildId === guildId).map(x => x.n));
  let n = 1; while (used.has(n)) n++;
  if (n > MAX_BOTS) throw new Error(`Os ${MAX_BOTS} bots de música deste servidor já estão tocando em outras salas`);
  const botId = botUserFor(guildId, n);
  if (!env.get('SELECT 1 x FROM members WHERE guild_id=? AND user_id=?', guildId, botId)) {
    env.run('INSERT INTO members(guild_id,user_id,joined_at) VALUES(?,?,?)', guildId, botId, Date.now());
    env.dispatch(env.guildMemberIds(guildId).filter(x => x !== botId), 'MEMBER_ADD', { guild_id: guildId, member: env.memberObj(guildId, botId), user: env.userPub(botId) });
  }
  const s = { guildId, channelId, botId, n, queue: [], history: [], current: null, paused: false, loading: false, pos: { base: 0, at: 0 },
    loop: 'off', autoplay: false, stay: false, proc: null, rtp: null, idleTimer: null, aloneTimer: null, gen: 0 };
  sessions.set(channelId, s);
  await env.joinBot(channelId, botId); // entra na sala (voice map + SFU)
  armIdle(s);
  return s;
}
function armIdle(s) { clearTimeout(s.idleTimer); if (!s.stay && (!s.current || s.paused)) s.idleTimer = setTimeout(() => endSession(s, 'Ficou inativo'), IDLE_MS); }

function killProc(s) {
  s.gen++; // invalida callbacks da faixa anterior
  for (const p of s.proc || []) { try { p.kill('SIGKILL'); } catch { } }
  s.proc = null; s.rtp?.close(); s.rtp = null;
}
export function endSession(s, reason) {
  if (!s || sessions.get(s.channelId) !== s) return;
  clearTimeout(s.idleTimer); clearTimeout(s.aloneTimer);
  killProc(s); sessions.delete(s.channelId);
  for (const [uid, st] of env.voice.get(s.channelId) || []) if (isHuman(uid)) env.send(st.ws, 'MUSIC_STATE', { channel_id: s.channelId, active: false, notice: reason });
  env.leaveBot(s.channelId, s.botId);
  env.run('DELETE FROM members WHERE guild_id=? AND user_id=?', s.guildId, s.botId);
  env.dispatch(env.guildMemberIds(s.guildId), 'MEMBER_REMOVE', { guild_id: s.guildId, user_id: s.botId });
}
export const stopAll = () => { for (const s of [...sessions.values()]) endSession(s, 'Servidor reiniciando'); };

const remember = (s, t) => { if (!t) return; s.history.push(t); if (s.history.length > MAX_HISTORY * 2) s.history.splice(0, s.history.length - MAX_HISTORY); };
// próxima faixa: respeita repetir faixa/fila e, com a fila vazia, a reprodução automática
async function playNext(s, { skipped = false } = {}) {
  killProc(s); clearTimeout(s.idleTimer);
  const prev = s.current;
  if (prev && s.loop === 'track' && !skipped) return startTrack(s, 0);
  if (prev) { remember(s, prev); if (s.loop === 'queue') s.queue.push({ ...prev, id: newTid() }); }
  s.current = s.queue.shift() || null; s.paused = false;
  if (!s.current && s.autoplay && prev) s.current = await related(s, prev).catch(() => null);
  if (!s.current) { push(s); return armIdle(s); }
  return startTrack(s, 0);
}
const newTid = () => crypto.randomBytes(5).toString('hex');
// reprodução automática: no YouTube, o "mix" da faixa (rádio); fora dele, busca pelo artista. Pula o que já tocou.
async function related(s, t) {
  s.loading = true; push(s);
  try {
    const played = new Set(s.history.slice(-50).map(x => x.url));
    const vid = String(t.url || '').match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/);
    let list = [];
    if (vid) { const id = vid[1] || vid[2]; const j = await runJson(['-J', '--flat-playlist', '--playlist-items', '2-12', '--', `https://www.youtube.com/watch?v=${id}&list=RD${id}`]); list = (j.entries || []).filter(Boolean).map(e => trackFrom(e)); }
    if (!list.length) list = await searchTracks(`${t.artist || t.title} mix`, 8);
    const pick = list.find(x => x.url && !played.has(x.url) && x.url !== t.url);
    return pick ? { ...pick, id: newTid(), by: s.botId, auto: true } : null;
  } finally { s.loading = false; }
}
// inicia (ou retoma) a faixa atual a partir de offsetMs (posição na música)
async function startTrack(s, offsetMs) {
  killProc(s);
  const gen = s.gen, t = s.current;
  s.paused = false; s.pos = { base: offsetMs, at: Date.now() };
  try {
    const rtp = await env.attachRtp(s.channelId, s.botId);
    if (gen !== s.gen) return rtp.close();
    s.rtp = rtp;
    const src = t.url || t.search;
    const dl = spawn(YTDLP, ytdlpArgs(['-f', 'bestaudio/best', '--no-playlist', '-o', '-', '--quiet', '--', src]), { stdio: ['ignore', 'pipe', 'pipe'] });
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...(offsetMs ? ['-ss', (offsetMs / 1000).toFixed(2)] : []), '-re', '-i', 'pipe:0', '-vn', '-map', '0:a:0',
      '-af', 'aresample=48000', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-application', 'audio',
      '-f', 'rtp', '-payload_type', String(rtp.payloadType), '-ssrc', String(rtp.ssrc), `rtp://127.0.0.1:${rtp.port}?pkt_size=1200`], { stdio: ['pipe', 'ignore', 'pipe'] });
    s.proc = [dl, ff];
    let dlErr = '', started = false;
    dl.stderr.on('data', d => (dlErr += d)); ff.stderr.on('data', () => { });
    dl.stdout.pipe(ff.stdin); ff.stdin.on('error', () => { }); dl.stdout.on('error', () => { });
    const fail = (msg) => { if (gen !== s.gen) return; s.current = null; push(s, { notice: `Não consegui tocar "${t.title}": ${msg}` }); playNext(s); };
    dl.on('error', () => fail('yt-dlp não está instalado no servidor')); ff.on('error', () => fail('ffmpeg não está instalado no servidor'));
    dl.stdout.once('data', () => { if (gen === s.gen && !started) { started = true; s.pos = { base: offsetMs, at: Date.now() }; s.loading = false; push(s); } });
    dl.on('close', (code) => { if (gen === s.gen && code !== 0 && !started) fail(ytErr(dlErr)); });
    ff.on('close', () => { if (gen !== s.gen) return; started ? playNext(s) : fail('formato de áudio não suportado'); }); // terminou a faixa
    s.loading = true; push(s);
  } catch (e) { if (gen === s.gen) { s.current = null; push(s, { notice: 'Falha ao tocar: ' + e.message }); playNext(s); } }
}

// ---------- playlists salvas no servidor ----------
const plList = (gid) => env.all('SELECT id, name, tracks, by_id, created_at FROM music_playlists WHERE guild_id=? ORDER BY name COLLATE NOCASE', gid)
  .map(p => { const t = JSON.parse(p.tracks); return { id: p.id, name: p.name, count: t.length, duration: t.reduce((a, x) => a + (x.duration || 0), 0), by: p.by_id, created_at: p.created_at }; });
const strip = (t) => ({ title: t.title, artist: t.artist, duration: t.duration, thumb: t.thumb, url: t.url, ...(t.search ? { search: t.search } : {}) });

// ---------- comandos vindos do gateway ----------
export async function handle(uid, cid, d) {
  const ch = env.get('SELECT * FROM channels WHERE id=?', cid);
  if (!ch || ch.type !== 2 || !ch.guild_id) throw new Error('O bot de música só funciona em salas de voz de servidores');
  let s = sessions.get(cid);
  const op = String(d.op);
  // sem precisar do bot na sala
  if (op === 'search') { if (!(await musicAvailable())) throw new Error('O servidor não tem yt-dlp/ffmpeg instalados (use a imagem Docker atualizada)'); return { results: await searchTracks(d.query, 6) }; }
  if (op === 'pl_list') return { playlists: plList(ch.guild_id) };
  if (op === 'pl_delete') {
    const p = env.get('SELECT by_id FROM music_playlists WHERE id=? AND guild_id=?', String(d.id), ch.guild_id); if (!p) throw new Error('Playlist não encontrada');
    if (p.by_id !== uid && !env.canManage?.(ch.guild_id, uid)) throw new Error('Só quem criou (ou um moderador) apaga a playlist');
    env.run('DELETE FROM music_playlists WHERE id=?', String(d.id)); return { playlists: plList(ch.guild_id) };
  }
  if (op === 'play' || op === 'pl_load') {
    if (!(await musicAvailable())) throw new Error('O servidor não tem yt-dlp/ffmpeg instalados (use a imagem Docker atualizada)');
    if (!env.sfuEnabled()) throw new Error('O bot de música precisa do SFU de voz ativo');
    let tracks;
    if (op === 'pl_load') { const p = env.get('SELECT tracks FROM music_playlists WHERE id=? AND guild_id=?', String(d.id), ch.guild_id); if (!p) throw new Error('Playlist não encontrada'); tracks = JSON.parse(p.tracks); }
    else tracks = d.track?.url ? [{ ...strip(d.track) }] : await resolveQuery(d.query); // track: escolhido nos resultados da busca
    s = sessions.get(cid) || await startSession(ch.guild_id, cid);
    const room = Math.max(0, MAX_QUEUE - s.queue.length - (s.current ? 1 : 0));
    const add = tracks.slice(0, room).map(t => ({ ...strip(t), id: newTid(), by: uid }));
    if (!add.length) throw new Error('A fila está cheia');
    const where = ['now', 'next'].includes(d.where) ? d.where : 'end';
    if (where === 'end') s.queue.push(...add); else s.queue.unshift(...add);
    if (!s.current) await playNext(s);
    else if (where === 'now') await playNext(s, { skipped: true });
    else push(s);
    return { added: add.length, title: add[0].title, where };
  }
  if (!s) throw new Error('O bot não está nesta sala');
  switch (op) {
    case 'skip': await playNext(s, { skipped: true }); break;
    case 'skipto': { const i = s.queue.findIndex(t => t.id === String(d.id)); if (i < 0) break; s.queue.splice(0, i); await playNext(s, { skipped: true }); break; }
    case 'back': { // volta para a anterior (a atual vai para o começo da fila)
      const prev = s.history.pop(); if (!prev) { if (s.current) await startTrack(s, 0); break; }
      if (s.current) s.queue.unshift({ ...s.current, id: newTid() });
      killProc(s); s.current = prev; await startTrack(s, 0); break;
    }
    case 'replay': if (s.current) await startTrack(s, 0); break;
    case 'seek': { if (!s.current) break; const ms = Math.max(0, Math.min((s.current.duration || 1e9) * 1000 - 1000, Math.round(+d.ms || 0)));
      if (s.paused) { s.pos = { base: ms, at: Date.now() }; push(s); } else await startTrack(s, ms); break; }
    case 'pause': if (s.current && !s.paused) { const at = elapsedOf(s); killProc(s); s.paused = true; s.pos = { base: at, at: Date.now() }; armIdle(s); push(s); } break; // pausar = parar o fluxo e retomar do mesmo ponto
    case 'resume': if (s.current && s.paused) { clearTimeout(s.idleTimer); await startTrack(s, s.pos.base); } break;
    case 'remove': { const i = s.queue.findIndex(t => t.id === String(d.id)); if (i >= 0) { s.queue.splice(i, 1); push(s); } break; }
    case 'move': { const i = s.queue.findIndex(t => t.id === String(d.id)); if (i < 0) break; const [t] = s.queue.splice(i, 1); s.queue.splice(Math.max(0, Math.min(s.queue.length, +d.to || 0)), 0, t); push(s); break; }
    case 'dedupe': { const seen = new Set(s.current ? [s.current.url] : []); s.queue = s.queue.filter(t => !seen.has(t.url) && seen.add(t.url)); push(s); break; }
    case 'clear': s.queue = []; push(s); break;
    case 'stop': s.queue = []; s.loop = 'off'; if (s.current) remember(s, s.current); killProc(s); s.current = null; push(s); armIdle(s); break;
    case 'shuffle': for (let i = s.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]]; } push(s); break;
    case 'loop': s.loop = LOOPS.includes(d.mode) ? d.mode : LOOPS[(LOOPS.indexOf(s.loop) + 1) % LOOPS.length]; push(s); break;
    case 'autoplay': s.autoplay = d.on === undefined ? !s.autoplay : !!d.on; push(s); if (s.autoplay && !s.current && s.history.length) await playNext(s); break;
    case 'stay': s.stay = d.on === undefined ? !s.stay : !!d.on; clearTimeout(s.aloneTimer); armIdle(s); push(s); break;
    case 'pl_save': {
      const name = String(d.name || '').trim().slice(0, 60); if (!name) throw new Error('Dê um nome para a playlist');
      const tracks = [s.current, ...s.queue].filter(Boolean).map(strip).slice(0, MAX_QUEUE); if (!tracks.length) throw new Error('A fila está vazia');
      const old = env.get('SELECT id, by_id FROM music_playlists WHERE guild_id=? AND name=? COLLATE NOCASE', s.guildId, name);
      if (old && old.by_id !== uid && !env.canManage?.(s.guildId, uid)) throw new Error('Já existe uma playlist com esse nome');
      if (old) env.run('UPDATE music_playlists SET tracks=?, by_id=?, created_at=? WHERE id=?', JSON.stringify(tracks), uid, Date.now(), old.id);
      else env.run('INSERT INTO music_playlists(id,guild_id,name,tracks,by_id,created_at) VALUES(?,?,?,?,?,?)', env.newId(), s.guildId, name, JSON.stringify(tracks), uid, Date.now());
      return { saved: tracks.length, playlists: plList(s.guildId) };
    }
    case 'disconnect': endSession(s, 'Removido da chamada'); break;
    default: throw new Error('comando desconhecido');
  }
  return {};
}
