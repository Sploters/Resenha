// Watch Together: adaptadores de serviço. Módulo isomórfico (sem DOM): o servidor usa para validar o que entra na fila
// e o cliente para escolher o player e explicar o nível de integração de cada serviço.
//
// Níveis de integração (nunca chamamos de "suportado" um serviço que só abre o site):
//   embedded  — reprodução integrada dentro do Resenha, com sincronização completa (play, pause, posição, próximo)
//   controls  — reprodução no contexto autenticado de cada participante (janela do serviço no app desktop) e
//               sincronização de controles pelo <video> da página, quando a página permite. Experimental.
//   assisted  — cada participante abre o conteúdo na própria conta (navegador ou app); o Resenha sincroniza o que é
//               possível sem controlar o player: o que assistir, contagem regressiva para dar play, posição combinada
//               e quem está pronto/atrasado.

export const LEVELS = {
  embedded: { label: 'Integrado', desc: 'Toca dentro do Resenha com play, pause, posição e próximo sincronizados para todos.' },
  controls: { label: 'Controles sincronizados', desc: 'Cada um assiste na própria conta, numa janela do serviço no app desktop; o Resenha sincroniza play, pause e posição pelo player da página. Experimental.' },
  assisted: { label: 'Sincronização assistida', desc: 'Cada um abre na própria conta. O Resenha combina o que assistir, faz a contagem para dar play juntos e mostra quem está adiantado ou atrasado; o play e o pause são feitos por cada um.' },
};

const ytTime = (t) => { const m = String(t || '').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
const parse = (s) => { try { const u = new URL(String(s || '').trim()); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };
const hostOf = (u) => u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
const slugTitle = (s) => decodeURIComponent(String(s || '')).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase()).slice(0, 120);

export const SERVICES = {
  youtube: {
    id: 'youtube', on: 'no YouTube', name: 'YouTube', color: '#ff0033', level: 'embedded', search: true,
    caps: { embed: true, play: true, pause: true, seek: true, next: true, episode: true, volume: true },
    hint: 'Busque pelo nome ou cole um link do YouTube',
    parse(url) {
      const u = parse(url); if (!u) return null;
      const host = hostOf(u), parts = u.pathname.split('/').filter(Boolean);
      let id = null;
      if (host === 'youtu.be') id = parts[0];
      else if (['youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
        if (parts[0] === 'watch') id = u.searchParams.get('v');
        else if (['shorts', 'live', 'embed', 'v'].includes(parts[0])) id = parts[1];
      }
      if (!/^[\w-]{11}$/.test(id || '')) return null;
      return { service: 'youtube', ref: id, url: `https://www.youtube.com/watch?v=${id}`, start: ytTime(u.searchParams.get('t') || u.searchParams.get('start')),
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, short: parts[0] === 'shorts' };
    },
    openUrl: (it, pos = 0) => `https://www.youtube.com/watch?v=${it.ref}${pos > 1 ? '&t=' + Math.floor(pos) + 's' : ''}`,
  },
  file: {
    id: 'file', on: 'no navegador', name: 'Link de vídeo', color: '#5865f2', level: 'embedded', search: false,
    caps: { embed: true, play: true, pause: true, seek: true, next: true, episode: true, volume: true },
    hint: 'Cole o link de um vídeo .mp4/.webm (ou de um vídeo enviado no chat)',
    parse(url, { origin } = {}) {
      const raw = String(url || '').trim();
      // vídeo enviado no Resenha: /files/... (relativo) vale para todos que estão no mesmo servidor
      if (/^\/files\/[\w./%-]+$/i.test(raw) && /\.(mp4|webm|m4v|mov|ogv)$/i.test(raw.split('?')[0])) return { service: 'file', ref: raw, url: raw, title: slugTitle(raw.split('/').pop().replace(/\.\w+$/, '')) };
      const u = parse(raw); if (!u) return null;
      if (!/\.(mp4|webm|m4v|ogv)$/i.test(u.pathname)) return null;
      const ref = origin && u.origin === origin && u.pathname.startsWith('/files/') ? u.pathname : u.href;
      return { service: 'file', ref, url: ref, title: slugTitle(u.pathname.split('/').pop().replace(/\.\w+$/, '')) };
    },
    openUrl: (it) => it.url,
  },
  netflix: {
    id: 'netflix', on: 'na Netflix', name: 'Netflix', color: '#e50914', level: 'assisted', drm: true, desktopWindow: true, search: false,
    caps: { embed: false, play: 'bridge', pause: 'bridge', seek: 'bridge-experimental', next: false, episode: 'link', volume: 'local' },
    hint: 'Cole o link de um título ou episódio da Netflix (netflix.com/watch/… ou /title/…)',
    login: 'https://www.netflix.com/login',
    parse(url) {
      const u = parse(url); if (!u || !/(^|\.)netflix\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/(watch|title)\/(\d{4,12})/); if (!m) return null;
      return { service: 'netflix', ref: m[1] + ':' + m[2], url: `https://www.netflix.com/${m[1]}/${m[2]}`, episode: m[1] === 'watch' };
    },
    openUrl: (it) => it.url,
  },
  prime: {
    id: 'prime', on: 'no Prime Video', name: 'Prime Video', color: '#00a8e1', level: 'assisted', drm: true, desktopWindow: true, search: false,
    caps: { embed: false, play: 'bridge', pause: 'bridge', seek: 'bridge', next: false, episode: 'link', volume: 'local' },
    hint: 'Cole o link de um título do Prime Video (primevideo.com/detail/… ou amazon…/gp/video/detail/…)',
    login: 'https://www.primevideo.com/',
    parse(url) {
      const u = parse(url); if (!u) return null;
      const host = hostOf(u);
      const ok = /(^|\.)primevideo\.com$/.test(host) || (/(^|\.)amazon\.[a-z.]+$/.test(host) && /\/gp\/video\//.test(u.pathname));
      if (!ok) return null;
      const m = u.pathname.match(/\/(?:gp\/video\/)?detail\/(?:[^/]+\/)?([A-Z0-9]{10,})/i) || u.pathname.match(/\/dp\/([A-Z0-9]{10,})/i);
      if (!m) return null;
      return { service: 'prime', ref: m[1].toUpperCase(), url: /primevideo/.test(host) ? `https://www.primevideo.com/detail/${m[1]}` : `${u.origin}/gp/video/detail/${m[1]}` };
    },
    openUrl: (it) => it.url,
  },
  crunchyroll: {
    id: 'crunchyroll', on: 'na Crunchyroll', name: 'Crunchyroll', color: '#f47521', level: 'assisted', drm: true, desktopWindow: true, search: false,
    caps: { embed: false, play: 'bridge', pause: 'bridge', seek: 'bridge', next: false, episode: 'link', volume: 'local' },
    hint: 'Cole o link de um episódio ou série da Crunchyroll (crunchyroll.com/watch/… ou /series/…)',
    login: 'https://www.crunchyroll.com/login',
    parse(url) {
      const u = parse(url); if (!u || !/(^|\.)crunchyroll\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/(watch|series)\/([A-Z0-9]{6,12})(?:\/([^/?#]+))?/i); if (!m) return null;
      return { service: 'crunchyroll', ref: m[1] + ':' + m[2].toUpperCase(), url: `https://www.crunchyroll.com/${m[1]}/${m[2]}${m[3] ? '/' + m[3] : ''}`, episode: m[1] === 'watch', title: m[3] ? slugTitle(m[3]) : '' };
    },
    openUrl: (it) => it.url,
  },
};
export const SERVICE_IDS = Object.keys(SERVICES);

// link → { service, ref, url, ... } de qualquer serviço (ou do serviço pedido); null se ninguém reconhece
export function parseLink(raw, { service, origin } = {}) {
  const order = service && SERVICES[service] ? [service, ...SERVICE_IDS.filter(s => s !== service)] : SERVICE_IDS;
  for (const id of order) { const r = SERVICES[id].parse(raw, { origin }); if (r) return r; }
  return null;
}
export const itemKey = (it) => it.service + ':' + it.ref; // usado para impedir duplicados na fila

// nível de integração efetivo neste cliente: os serviços com DRM só passam de "assistido" para "controles" no app
// desktop com uma janela de serviço que tenha Widevine (o Electron padrão não tem; ver docs/WATCH-TOGETHER.md)
export function effectiveLevel(service, env = {}) {
  const s = SERVICES[service]; if (!s) return null;
  if (s.level !== 'assisted') return s.level;
  return env.desktopWindow && env.widevine ? 'controls' : 'assisted';
}

// erros que o player relata → texto e ações para a interface (nada de tela preta sem explicação)
export const ERRORS = {
  embed_blocked: { title: 'Este vídeo não pode tocar fora do YouTube', text: 'O dono do vídeo desativou a reprodução em outros sites.', fatal: true, actions: ['open', 'skip'] },
  yt_refused: { title: 'O YouTube recusou tocar este vídeo aqui', text: 'O vídeo permite ser incorporado, mas o YouTube não liberou a reprodução nesta rede ou aparelho (bloqueio de rede, VPN ou verificação anti-robô).', fatal: true, actions: ['open', 'retry', 'skip'] },
  not_found: { title: 'Vídeo indisponível', text: 'O vídeo foi removido, é privado ou o link está errado.', fatal: true, actions: ['skip'] },
  region: { title: 'Indisponível na sua região', text: 'Este conteúdo não está liberado no seu país.', fatal: false, actions: ['open', 'skip'] },
  age: { title: 'Precisa entrar na conta', text: 'O vídeo tem restrição de idade e só toca no site, com login.', fatal: false, actions: ['open', 'skip'] },
  html5: { title: 'O player não conseguiu tocar', text: 'Formato não suportado ou falha ao carregar o vídeo.', fatal: false, actions: ['retry', 'skip'] },
  network: { title: 'Falha de conexão', text: 'Não foi possível carregar o vídeo. Verifique sua internet.', fatal: false, actions: ['retry'] },
  api_blocked: { title: 'O player do YouTube não carregou', text: 'Algo (firewall, bloqueador ou rede) impediu o player oficial do YouTube.', fatal: false, actions: ['retry', 'open'] },
  stuck: { title: 'O vídeo não começou a tocar', text: 'O player carregou, mas o site não liberou a reprodução (pode ser bloqueio de rede, de região ou do próprio site).', fatal: false, actions: ['retry', 'open', 'skip'] },
  autoplay: { title: 'Clique para entrar no vídeo', text: 'O navegador bloqueou a reprodução automática com som.', fatal: false, actions: ['resume'] },
  drm: { title: 'Proteção de conteúdo (DRM) indisponível aqui', text: 'Este serviço exige o módulo Widevine, que este app não tem. Assista na sua conta pelo navegador: o Resenha continua sincronizando a contagem e a posição.', fatal: false, actions: ['open'] },
  login: { title: 'Entre na sua conta', text: 'O serviço pediu login. Cada participante assiste com a própria conta.', fatal: false, actions: ['login', 'open'] },
  subscription: { title: 'Sem acesso a este conteúdo', text: 'Sua conta não tem assinatura ou acesso a este título. Os outros continuam assistindo.', fatal: false, actions: ['open'] },
  service_down: { title: 'Serviço fora do ar', text: 'O serviço não respondeu. Tente de novo em instantes.', fatal: false, actions: ['retry', 'open'] },
};
