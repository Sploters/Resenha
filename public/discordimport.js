// Importar a estrutura de um servidor do Discord (server/discordimport.js): cola o link do modelo (discord.new/…), vê o
// resumo (cargos, categorias, canais e o que não tem equivalente) e confirma. Nada do que já existe é apagado.
import { h, icon } from './util.js';
import { tryApi, toast, modal } from './state.js';

const TYPE_ICON = { 0: 'hash', 2: 'voice', 4: 'chevdown', 5: 'megaphone', 15: 'forum', 16: 'image' };
export function discordStructureModal(g) {
  const link = h('input', { placeholder: 'https://discord.new/AbCdEf123', maxLength: 200, name: 'discord-template' });
  const out = h('div.dsi-out'), roles = h('input', { type: 'checkbox', checked: true }), chans = h('input', { type: 'checkbox', checked: true });
  let ready = null;
  const preview = async () => {
    ready = null; out.replaceChildren(h('small.mut', 'Lendo o modelo no Discord…'));
    const r = await tryApi('POST', `/guilds/${g.id}/discord-structure/preview`, { template: link.value });
    if (!r) { out.replaceChildren(); return; }
    ready = link.value;
    out.replaceChildren(
      h('div.dsi-sum', h('b', r.name || 'Modelo'), h('span', `${r.counts.roles} cargos · ${r.counts.categories} categorias · ${r.counts.text} canais de texto · ${r.counts.voice} salas de voz`)),
      h('div.dsi-cols',
        h('div.dsi-list', r.roles.slice(0, 40).map(x => h('div', h('i.dot', { style: { background: x.color } }), x.name))),
        h('div.dsi-list', r.channels.slice(0, 60).map(c => c.type === 4 ? h('div.dsi-cat', c.name) : h('div' + (c.parent ? '.dsi-in' : ''), icon(TYPE_ICON[c.type] || 'hash', 14), c.name)))),
      h('div.dsi-opts', h('label', roles, ' Cargos (com as permissões)'), h('label', chans, ' Categorias e canais (com as permissões por canal)')),
      h('ul.dsi-warn', r.warnings.map(w => h('li', w))));
  };
  const body = h('div.dsi',
    h('p.mut', 'No Discord: Configurações do servidor → Modelo de servidor → gere o modelo e copie o link. Os cargos, categorias, canais e permissões entram aqui, ', h('b', 'somados'), ' ao que o servidor já tem (nada é apagado).'),
    h('label.f', 'Link do modelo', h('div.dsi-row', link, h('button.btn.grey', { type: 'button', onclick: preview }, 'Ver o que entra'))),
    out);
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); preview(); } });
  modal('Importar estrutura do Discord', g.name, body, [
    { label: 'Cancelar', cls: 'link' },
    { label: 'Importar', fn: async () => {
      if (!ready || ready !== link.value) { await preview(); return false; }
      if (!roles.checked && !chans.checked) { toast('Escolha cargos, canais ou os dois', true); return false; }
      const r = await tryApi('POST', `/guilds/${g.id}/discord-structure`, { template: link.value, roles: roles.checked, channels: chans.checked });
      if (!r) return false;
      const c = r.created; toast(`Importado: ${c.roles} cargos, ${c.categories} categorias e ${c.channels} canais`);
    } }], { width: 'min(640px, 94vw)' });
}
