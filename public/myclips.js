// "Compartilhar um clipe" (+ do campo de mensagem) e "Meus clipes" (Configurações → Clipes): os clipes guardados só neste
// aparelho, agrupados pelo jogo (ou por quem transmitia). Passar o mouse mostra Compartilhar / Editar; o menu ⋯ tem baixar,
// renomear e excluir. Nada sobe para o servidor até "Compartilhar".
import { h, icon, whenGone } from './util.js';
import { modal, toast, confirmBox, promptBox, menu, channelById } from './state.js';
import { listLocalClips, getLocalClip, updateLocalClip, deleteLocalClip, onLocalClips } from './cliplocal.js';
import { openTrimmer } from './cliptrim.js';
import { postClip } from './clips.js';

const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'agora'; if (s < 3600) return `há ${Math.floor(s / 60)} min`; if (s < 86400) return `há ${Math.floor(s / 3600)} h`; const d = Math.floor(s / 86400); return d < 30 ? `há ${d} d` : new Date(t).toLocaleDateString('pt-BR'); };
export const mb = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const dur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fileName = (c) => (c.title || 'clipe').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.webm';

export function download(c) {
  const url = URL.createObjectURL(c.blob), a = h('a', { href: url, download: fileName(c) });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
// compartilhar = subir o vídeo e postar no canal (entra também na galeria do servidor, se for um servidor)
async function share(c, ch, blob = c.blob, secs = c.secs, title = c.title) {
  const ok = await postClip(blob, { channelId: ch.id, secs, streamerId: c.streamerId, hasAudio: c.hasAudio !== false, title, who: c.who, quiet: true });
  if (ok) toast(`Clipe "${title}" compartilhado`);
  return ok;
}
// editor: corta o trecho e troca o título; ✓ salva no aparelho (substitui o clipe) e, com um canal, dá para já compartilhar
export async function editClip(id, ch, after) {
  const c = await getLocalClip(id); if (!c) return toast('Esse clipe não existe mais', true);
  const saveLocal = async ({ blob, secs, title, whole }) => {
    await updateLocalClip(id, { ...(whole ? {} : { blob, secs, thumb: null }), title: title || c.title });
    if (!whole) import('./cliplocal.js').then(m => m.makeThumb(blob)).then(t => t && updateLocalClip(id, { thumb: t }));
    toast('Clipe salvo neste aparelho'); after?.();
  };
  openTrimmer(new Uint8Array(await c.blob.arrayBuffer()), { heading: 'Editar clipe', title: c.title,
    ...(ch ? { action: 'Compartilhar clipe', secondary: { label: 'Salvar', fn: saveLocal },
      onSave: async (r) => { await saveLocal(r); return share(c, ch, r.blob, r.secs, r.title || c.title).then(ok => { if (ok) after?.('shared'); return ok; }); } }
      : { action: 'Salvar', onSave: saveLocal }) });
}

// ch: canal/conversa onde "Compartilhar" posta (sem ele, a janela só gerencia os clipes)
export function openMyClips({ ch } = {}) {
  const body = h('div.myclips'), q = h('input.mc-q', { placeholder: 'Buscar por título, jogo ou pessoa', oninput: () => draw() });
  const urls = []; // miniaturas criadas (soltas ao redesenhar e ao fechar)
  const free = () => { urls.splice(0).forEach(u => URL.revokeObjectURL(u)); };
  let clips = [];
  const card = (c) => {
    const th = c.thumb ? URL.createObjectURL(c.thumb) : null; if (th) urls.push(th);
    const more = (e) => { e.stopPropagation(); menu(e, [
      { label: 'Editar', icon: 'edit', fn: () => editClip(c.id, ch, (r) => (r === 'shared' ? m.close() : load())) },
      { label: 'Renomear', icon: 'edit', fn: async () => { const t = await promptBox('Renomear clipe', 'Título', c.title, 'Salvar'); if (t) { await updateLocalClip(c.id, { title: t.slice(0, 100) }); } } },
      { label: 'Baixar', icon: 'download', fn: () => download(c) },
      '-',
      { label: 'Excluir', icon: 'trash', danger: true, fn: async () => { if (await confirmBox('Excluir clipe', `"${c.title}" será apagado deste aparelho. Depois de excluído, não dá para recuperar.`, 'Excluir')) { await deleteLocalClip(c.id); toast('Clipe excluído'); } } }]); };
    return h('div.mc-card', { title: c.title },
      h('div.mc-thumb', th ? h('img', { src: th, alt: '', loading: 'eager' }) : icon('clip', 28), h('span.mc-dur', dur(c.secs || 0)), c.hasAudio === false && h('span.mc-mute', { title: 'Sem áudio' }, icon('volmute', 12)),
        h('div.mc-hover',
          ch && h('button.btn.green.sm', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; if (await share(c, ch)) m.close(); else b.disabled = false; } }, 'Compartilhar'),
          h('button.btn.grey.sm', { onclick: () => editClip(c.id, ch, (r) => (r === 'shared' ? m.close() : load())) }, icon('edit', 14), 'Editar'))),
      h('div.mc-info', h('b', c.title), h('small', [c.who && `de ${c.who}`, ago(c.created), mb(c.size || 0)].filter(Boolean).join(' · ')),
        h('button.ibtn.mc-more', { title: 'Mais opções', 'aria-label': 'Mais opções', onclick: more }, icon('more', 16))));
  };
  const draw = () => {
    free();
    const t = q.value.trim().toLowerCase();
    const list = clips.filter(c => !t || [c.title, c.game, c.who].some(x => x?.toLowerCase().includes(t)));
    if (!clips.length) return body.replaceChildren(h('div.mc-empty', icon('clip', 36), h('b', 'Nenhum clipe neste aparelho'),
      h('p', 'Durante uma transmissão na sala de voz, aperte o atalho do clipe (Configurações → Clipes) ou o botão de clipe no quadro da transmissão. O clipe fica guardado aqui até você compartilhar.')));
    // agrupado pelo jogo (como no Discord), ou por quem transmitia quando não se sabe o jogo
    const groups = new Map();
    for (const c of list) { const g = c.game || (c.who ? `Transmissão de ${c.who}` : 'Outros'); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
    body.replaceChildren(q, ...[...groups].map(([g, l]) => h('section.mc-group', h('h4', g, h('small', ` · ${l.length}`)), h('div.mc-grid', l.map(card)))),
      !list.length && h('div.mc-empty', h('b', 'Nada encontrado')));
  };
  const load = async () => { clips = await listLocalClips().catch(() => []); draw(); };
  const off = onLocalClips(() => load());
  const where = ch ? (ch.guild_id ? `#${ch.name}` : 'esta conversa') : null;
  const m = modal(ch ? 'Compartilhar um clipe' : 'Meus clipes', ch ? `Os clipes estão guardados só neste aparelho. Escolha um para enviar em ${where}.` : 'Guardados só neste aparelho: ninguém vê até você compartilhar.', body,
    [{ label: 'Fechar', cls: 'link' }], { width: '760px' });
  whenGone(m.el, () => { off(); free(); });
  load();
  return m;
}
export const openShareClip = (ch) => openMyClips({ ch: typeof ch === 'string' ? channelById(ch) : ch });
