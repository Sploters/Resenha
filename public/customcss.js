// CSS personalizado (Aparência → CSS personalizado): o visual inteiro pode ser mudado com CSS, como os temas do
// BetterDiscord/Vencord, mas de fábrica e sem instalar nada. Fica na conta (S.prefs.customCss, sincroniza entre aparelhos)
// e é aplicado num <style id="custom-css"> por último, então ganha dos estilos do app.
// Modo seguro: ?semcss no endereço ou Ctrl+Shift+Alt+S carrega sem o CSS (para consertar um CSS que quebrou a tela).
import { h, icon } from './util.js';
import { S, savePrefs, toast, confirmBox } from './state.js';

export const CUSTOM_CSS_MAX = 50000;
const SAFE_KEY = 'lc_nocss';
export function cssSafeMode() {
  try { if (/[?&]semcss\b/.test(location.search)) sessionStorage.setItem(SAFE_KEY, '1'); return sessionStorage.getItem(SAFE_KEY) === '1'; } catch { return false; }
}
// ligar/desligar o modo seguro nesta janela sem recarregar
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyS')) return;
  e.preventDefault();
  try { if (cssSafeMode()) sessionStorage.removeItem(SAFE_KEY); else sessionStorage.setItem(SAFE_KEY, '1'); } catch { }
  applyCustomCss(); toast(cssSafeMode() ? 'Modo seguro: CSS personalizado desligado nesta janela' : 'CSS personalizado ligado de novo');
}, true);

// @import de outro endereço só vale no topo do CSS; o resto vai como está. O app não roda nada do CSS: é só estilo.
export function applyCustomCss(preview) {
  let el = document.getElementById('custom-css');
  const css = preview ?? (S.prefs.customCssOn !== false ? (S.prefs.customCss || '') : '');
  const text = cssSafeMode() && preview == null ? '' : String(css).slice(0, CUSTOM_CSS_MAX);
  if (!text.trim()) { el?.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'custom-css'; }
  if (el.textContent !== text) el.textContent = text;
  if (el !== document.head.lastElementChild) document.head.append(el); // sempre o último: ganha dos estilos do app
}

// variáveis de cor e medidas que o app usa (as que vale a pena trocar primeiro)
const VARS = [
  ['--bg-tert', 'fundo mais escuro (barra dos servidores)'], ['--bg-sec', 'lista de canais e conversas'], ['--bg-pri', 'área do chat'], ['--bg-float', 'menus, janelas e cartões'],
  ['--bg-user', 'barra do perfil (embaixo)'], ['--bg-input', 'campos de texto'], ['--bg-mod-hover', 'item com o mouse em cima'], ['--bg-mod-sel', 'item selecionado'],
  ['--text', 'texto'], ['--text-muted', 'texto apagado'], ['--text-strong', 'texto forte'], ['--header', 'títulos'], ['--interactive', 'ícones'], ['--interactive-hover', 'ícones com o mouse em cima'],
  ['--brand', 'cor de destaque'], ['--green', 'verde (online, confirmar)'], ['--red', 'vermelho (perigo, não lidas)'], ['--yellow', 'amarelo (ausente)'], ['--link', 'links'],
  ['--divider', 'linhas divisórias'], ['--mention-bg', 'fundo das menções'], ['--font', 'fonte da interface'], ['--radius', 'arredondamento dos cartões'], ['--msg-gap', 'espaço entre grupos de mensagens'],
];
// partes da tela com nomes estáveis (não mudam entre atualizações)
const HOOKS = [
  ['#rail', 'barra dos servidores (esquerda)'], ['#side', 'lista de canais / conversas'], ['#main', 'área principal'], ['#topbar', 'barra do topo da conversa'],
  ['#msgs', 'lista de mensagens'], ['.msg', 'uma mensagem'], ['.msg .author', 'nome de quem escreveu'], ['.msg .body', 'texto da mensagem'], ['.msg .av', 'avatar na mensagem'],
  ['#composer', 'caixa de escrever'], ['#members', 'lista de membros'], ['#dmpanel', 'perfil ao lado da conversa'], ['#user-area', 'barra do perfil e da voz'], ['#settings', 'configurações'],
  ['[data-theme="light"]', 'só no tema claro'], ['html.anim', 'animações ligadas'],
];
const SNIPPETS = [
  ['Chat com bolhas', `/* mensagens em bolhas */\n#msgs .msg .body { background: var(--bg-sec); padding: 6px 10px; border-radius: 12px; width: fit-content; max-width: 100%; }`],
  ['Cantos retos', `/* tudo quadrado */\n:root { --radius: 0px; }\n.btn, .modal, .popout, .menu, #composer { border-radius: 0 !important; }`],
  ['Fundo com imagem', `/* troque o endereço pela sua imagem */\n#main { background: linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.6)), url("https://exemplo.com/fundo.jpg") center / cover; }`],
  ['Fonte maior no chat', `/* só o texto das mensagens */\n#msgs .msg .body { font-size: 1.1rem; line-height: 1.5; }`],
  ['Esconder avatares no chat', `#msgs .msg .av { visibility: hidden; }`],
  ['Fonte do Google', `/* @import sempre no topo do CSS */\n@import url("https://fonts.googleapis.com/css2?family=Nunito:wght@400;700&display=swap");\n:root { --font: "Nunito", sans-serif; }`],
];

// editor no painel lateral: prévia ao vivo no app enquanto digita; Salvar grava na conta, Cancelar volta ao que era
export function openCssEditor(onExit, initial) {
  document.getElementById('tedit')?.remove();
  const settings = document.getElementById('settings');
  const before = S.prefs.customCss || '';
  let saved = false, peek = false;
  const ta = h('textarea.css-ta', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', maxLength: CUSTOM_CSS_MAX, placeholder: '/* Escreva CSS aqui. Ex.:\n#msgs .msg .author { text-transform: uppercase; } */' });
  ta.value = initial ?? before;
  const count = h('small.css-count'), errs = h('div.css-err');
  const check = () => { // aviso simples de chaves que não fecham (o navegador ignora o resto do bloco)
    const body = ta.value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
    let depth = 0; for (const c of body) { if (c === '{') depth++; else if (c === '}' && --depth < 0) break; }
    errs.textContent = depth > 0 ? `Falta fechar ${depth} chave${depth > 1 ? 's' : ''} "}"` : depth < 0 ? 'Há uma "}" sobrando' : '';
  };
  let t; const live = () => { count.textContent = `${ta.value.length.toLocaleString('pt-BR')} / ${CUSTOM_CSS_MAX.toLocaleString('pt-BR')}`; check(); clearTimeout(t); t = setTimeout(() => applyCustomCss(ta.value), 200); };
  ta.addEventListener('input', live);
  ta.addEventListener('keydown', (e) => { // Tab indenta em vez de sair do campo; Ctrl+S salva
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); live(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  const insert = (txt) => { const pre = ta.value && !ta.value.endsWith('\n') ? '\n\n' : ta.value ? '\n' : ''; ta.value += pre + txt + '\n'; ta.focus(); ta.scrollTop = ta.scrollHeight; live(); };
  const exit = () => {
    clearTimeout(t); if (!saved) applyCustomCss();
    panel.remove(); document.removeEventListener('keydown', esc, true);
    settings?.classList.remove('hidden'); onExit?.();
  };
  const save = () => {
    const v = ta.value.slice(0, CUSTOM_CSS_MAX);
    S.prefs.customCss = v; S.prefs.customCssOn = true; savePrefs(); saved = true; applyCustomCss();
    toast(v.trim() ? 'CSS salvo e aplicado' : 'CSS personalizado removido'); exit();
  };
  const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.backdrop:not(.leaving)')) { e.stopPropagation(); exit(); } };
  document.addEventListener('keydown', esc, true);
  const refBox = h('div.css-ref.hidden',
    h('h5', 'Variáveis (clique para usar)'), h('div.css-list', VARS.map(([v, d]) => h('button', { type: 'button', title: 'Inserir', onclick: () => insert(`:root { ${v}: ; }`) }, h('code', v), h('span', d)))),
    h('h5', 'Partes da tela'), h('div.css-list', HOOKS.map(([sel, d]) => h('button', { type: 'button', title: 'Inserir', onclick: () => insert(`${sel} {\n  \n}`) }, h('code', sel), h('span', d)))),
    h('h5', 'Exemplos'), h('div.css-list', SNIPPETS.map(([n, c]) => h('button', { type: 'button', onclick: () => insert(c) }, h('b', n)))));
  const panel = h('aside#tedit.cssedit',
    h('header', h('b', 'CSS personalizado'), h('button.ibtn', { title: 'Fechar (Esc)', onclick: exit }, icon('x', 18))),
    h('div.tbody',
      h('p.css-help', 'O app muda enquanto você digita. Use as variáveis e as partes da tela da Referência: elas não mudam entre atualizações.'),
      ta, h('div.css-meta', errs, count),
      h('div.tbtns',
        h('button.btn.grey.wide', { onclick: () => refBox.classList.toggle('hidden') }, icon('info', 16), 'Referência'),
        h('button.btn.grey.wide', { title: 'Esconde o painel por 3 s para ver a tela inteira', onclick: () => { if (peek) return; peek = true; panel.style.opacity = '0'; panel.style.pointerEvents = 'none'; setTimeout(() => { peek = false; panel.style.opacity = ''; panel.style.pointerEvents = ''; }, 3000); } }, icon('eye', 16), 'Ver a tela')),
      refBox,
      h('p.css-warn', icon('warn', 14), ' Só cole CSS de quem você confia: um CSS pode carregar imagens e fontes de outros sites (eles ficam sabendo que você abriu o app) e esconder partes da tela. Ele não consegue ler suas mensagens nem sua senha.')),
    h('footer',
      h('button.btn.wide', { onclick: save }, 'Salvar e usar'),
      h('div.tbtns',
        h('button.btn.grey.wide', { onclick: async () => { if (!ta.value || await confirmBox('Limpar CSS', 'Apagar todo o CSS do editor? (Só vale depois de salvar.)', 'Limpar')) { ta.value = ''; live(); } } }, 'Limpar'),
        h('button.btn.grey.wide', { onclick: exit }, 'Cancelar'))));
  settings?.classList.add('hidden');
  document.getElementById('layer').append(panel);
  live(); setTimeout(() => ta.focus(), 0);
}
