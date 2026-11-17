// Texto para voz (ideia: "Taxa de texto-para-voz" da aba Acessibilidade do Discord). Usa a voz do próprio sistema/navegador
// (speechSynthesis): nada passa pelo servidor da Resenha. Algumas vozes "online" do navegador (ex.: Google no Chrome)
// mandam o texto para fora; por isso mensagens protegidas (E2EE) só são lidas com uma voz local do aparelho.
// Preferências: ttsRate (0.5–2, padrão 1) e ttsVoice (voiceURI; vazio = a melhor voz em português que houver).
import { S, toast } from './state.js';

export const ttsSupported = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

// as vozes chegam depois de abrir a página no Chrome (evento voiceschanged)
export function ttsVoices() {
  if (!ttsSupported()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise(res => { const t = setTimeout(() => res(speechSynthesis.getVoices()), 1500); speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); res(speechSynthesis.getVoices()); }, { once: true }); });
}

const lang = () => (navigator.language || 'pt-BR').toLowerCase();
function pickVoice(voices, { localOnly } = {}) {
  const ok = voices.filter(v => !localOnly || v.localService);
  const chosen = ok.find(v => v.voiceURI === S.prefs.ttsVoice);
  if (chosen) return chosen;
  const l = lang(), base = l.split('-')[0];
  return ok.find(v => v.lang.toLowerCase() === l && v.default) || ok.find(v => v.lang.toLowerCase() === l) || ok.find(v => v.lang.toLowerCase().startsWith(base)) || ok.find(v => v.default) || ok[0] || null;
}

// texto de chat → texto para ler: tira markdown, links viram "link", menções e emojis personalizados viram nomes
export function speakableText(src, { nameOf = (id) => 'alguém' } = {}) {
  return String(src || '')
    .replace(/```[\s\S]*?```/g, ' bloco de código ')
    .replace(/<a?:(\w+):\d+>/g, ' $1 ')
    .replace(/<@!?(\w+)>/g, (_, id) => ' ' + nameOf(id) + ' ')
    .replace(/<t:(-?\d{1,12})(?::[tTdDfFR])?>/g, (_, s) => new Date(+s * 1000).toLocaleString('pt-BR'))
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/\|\|[\s\S]*?\|\|/g, ' spoiler ')
    .replace(/[*_~`>#]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

let current = null;
export const ttsSpeaking = () => !!current;
export function ttsStop() { if (ttsSupported()) speechSynthesis.cancel(); current = null; }

export async function speak(text, { localOnly = false, rate } = {}) {
  if (!ttsSupported()) { toast('Este navegador não tem leitura em voz alta.', true); return false; }
  text = String(text || '').trim(); if (!text) return false;
  const voice = pickVoice(await ttsVoices(), { localOnly });
  if (localOnly && !voice) { toast('Mensagem protegida: só é lida com uma voz instalada no aparelho, e este navegador não tem nenhuma.', true); return false; }
  ttsStop();
  const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
  if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = navigator.language || 'pt-BR';
  u.rate = Math.max(0.5, Math.min(2, rate ?? S.prefs.ttsRate ?? 1));
  current = u; u.onend = u.onerror = () => { if (current === u) current = null; };
  speechSynthesis.speak(u);
  return true;
}
