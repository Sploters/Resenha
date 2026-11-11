// Parte do scripts/abuse-regex-test.mjs: roda uma função do chat com um texto, num worker que pode ser morto se travar.
import { parentPort, workerData } from 'node:worker_threads';
const noop = () => { }, el = () => new Proxy(function () { }, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : el()), apply: () => el(), construct: () => el() });
class E { } Object.assign(globalThis, { Element: E, DocumentFragment: E, HTMLElement: E, Node: E, window: globalThis, location: { origin: 'http://x', hash: '', href: 'http://x/' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, sessionStorage: { getItem: () => null, setItem: noop }, matchMedia: () => ({ matches: false, addEventListener: noop }),
  document: el(), requestAnimationFrame: noop, MutationObserver: class { observe() { } disconnect() { } }, IntersectionObserver: class { observe() { } disconnect() { } }, ResizeObserver: class { observe() { } disconnect() { } }, CSS: { supports: () => false }, addEventListener: noop });
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: '', language: 'pt-BR', mediaDevices: el() }, configurable: true }); } catch { }
const base = new URL('../public/', import.meta.url);
const U = await import(new URL('util.js', base)), T = await import(new URL('themes.js', base));
let G = {}, M = {}; try { G = await import(new URL("gifs.js", base)); } catch (e) { console.error("gifs.js", e.message); } try { M = await import(new URL('media.js', base)); } catch { }
const fns = {
  md: (s) => U.md(s, {}), cleanLinks: U.cleanLinks, inviteCodes: U.inviteCodes, callCodes: U.callCodes, stripInvites: U.stripInvites,
  clipLinkIds: U.clipLinkIds, stripClipLinks: U.stripClipLinks, inviteText: U.inviteText, plainTs: U.plainTs, onlyEmoji: U.onlyEmoji, isImageUrl: U.isImageUrl,
  themeText: T.themeText, stripThemeCodes: T.stripThemeCodes, themeRe: (s) => T.THEME_CODE_RE.test(s),
  isGif: G.isGifMessage, videoLinks: M.videoLink && ((s) => (s.match(/https?:\/\/[^\s<>)]+/g) || []).slice(0, 6).map(M.videoLink)),
};
parentPort.postMessage({ ready: Object.keys(fns).filter(k => fns[k]) });
parentPort.on('message', ({ fn, s }) => { const t = performance.now(); try { fns[fn](s); } catch { } parentPort.postMessage({ ms: performance.now() - t }); });
