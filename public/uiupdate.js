// Versão nova da interface sem atrapalhar ninguém (como o Discord faz com o cliente web).
// O servidor troca a interface sem reiniciar (deploy/umbrel.sh + SIGHUP, server/static.js reload) e avisa as páginas
// abertas (UI_VERSION; a versão também vem no READY). A página sabe com qual versão abriu (<meta name="lc-ui">).
// Quando recarrega:
// - fora de chamada: assim que a pessoa não estiver usando (janela escondida/minimizada ou 10 min sem mexer);
// - em chamada parada (sozinha, ou ninguém fala há 15 min e ninguém transmite: o servidor decide, /api/voice/quiet) e a
//   pessoa não estiver usando: recarrega e VOLTA SOZINHA para a chamada, com o mesmo mudo/ensurdecido. Os outros não
//   ouvem o som de sair e entrar (fecha com o código 4002: o servidor avisa reason 'reload');
// - chamada com conversa acontecendo: espera. Pendente há mais de 24 h, recarrega de madrugada (3 h às 6 h, hora deste
//   aparelho) com a pessoa longe do aparelho, mesmo em chamada: ninguém fica para sempre na versão velha;
// - quando a pessoa está usando: um cartão no canto com "Recarregar agora" (volta para a chamada também) e "Depois".
// Rascunhos de mensagem ficam guardados neste aparelho (composer.js), então recarregar não perde o que estava escrito.
import { h, icon } from './util.js';
import { api } from './state.js';
import { voice, ws } from './gateway.js';

const IDLE_MS = 10 * 60e3, CHECK_MS = 30e3, FORCE_AFTER = 24 * 3600e3, NIGHT = [3, 4, 5];
export const UI_RELOAD_KEY = 'lc_uireload'; // { cid, at }: recarregou sozinha no meio desta chamada (userbar.js volta)
let mine = document.querySelector('meta[name="lc-ui"]')?.content || null;
let pending = null, since = 0, lastInput = Date.now(), timer = 0, busy = false, card = null, later = null, reloading = false;
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
document.addEventListener('visibilitychange', () => { if (pending) tick(); });

// versão que o servidor está entregando agora (READY ou UI_VERSION)
export function onUiVersion(v) {
  if (!v) return;
  if (!mine) { mine = v; return; } // página sem a meta (STATIC_OFF / desenvolvimento): a primeira que chegar é a dela
  if (v === mine) { pending = null; since = 0; hideCard(); return; }
  if (pending !== v) { pending = v; since ||= Date.now(); }
  if (!timer) timer = setInterval(tick, CHECK_MS);
  tick();
}

const away = () => document.hidden || Date.now() - lastInput > IDLE_MS;
const inCall = () => !!(voice?.channelId || voice?._joinTo);

async function tick() {
  if (!pending || busy || reloading) return;
  if (!away()) return showCard();
  if (!inCall()) return reloadNow();
  busy = true;
  try {
    let quiet = Date.now() - since > FORCE_AFTER && NIGHT.includes(new Date().getHours());
    if (!quiet) quiet = !!(await api('GET', '/voice/quiet').catch(() => null))?.quiet;
    if (quiet && pending && away()) await reloadNow();
  } finally { busy = false; }
}

async function reloadNow() {
  if (reloading) return; reloading = true;
  const cid = voice?.channelId;
  if (cid) {
    try { localStorage.setItem(UI_RELOAD_KEY, JSON.stringify({ cid, at: Date.now() })); } catch { }
    // sai da sala avisando que é recarga (4002), e espera o aviso sair antes de a página ir embora
    const w = ws;
    if (w?.readyState === 1) await new Promise((res) => { w.onclose = null; w.addEventListener('close', res); setTimeout(res, 800); try { w.close(4002, 'recarregando'); } catch { res(); } });
  }
  location.reload();
}

function showCard() {
  if (card || later === pending) return;
  const call = inCall();
  const msg = h('p', call
    ? 'Ela entra sozinha quando a chamada estiver parada. Recarregar agora leva poucos segundos e você volta para a chamada.'
    : 'Ela entra sozinha quando você não estiver usando o Resenha, ou recarregue agora (leva poucos segundos).');
  const btnLater = h('button.btn.link', { onclick: () => { later = pending; hideCard(); } }, 'Depois');
  const btnNow = h('button.btn.green', { onclick: () => { hideCard(); reloadNow(); } }, 'Recarregar agora');
  card = h('div.appupd.uiupd', { role: 'status' },
    h('div.au-ico', icon('dl', 20)),
    h('div.au-body', h('b', 'Versão nova do Resenha'), msg, h('div.au-btns', btnLater, btnNow)));
  document.body.append(card);
}
function hideCard() { card?.remove(); card = null; }
