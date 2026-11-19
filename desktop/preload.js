const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lcDesktop', {
  isDesktop: true,
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id, name) => ipcRenderer.invoke('select-source', id, name),
  foregroundSource: () => ipcRenderer.invoke('foreground-source'), // atalho da transmissão: { id, name, type, pid?, game? } do que está na frente
  // áudio da transmissão só do jogo (loopback por processo do Windows; desde a 1.0.24): ver desktop/appaudio.js
  appAudioCapable: () => ipcRenderer.invoke('app-audio-capable'),
  appAudioStart: (o) => ipcRenderer.invoke('app-audio-start', o),
  appAudioStop: () => ipcRenderer.send('app-audio-stop'),
  onAppAudioEvent: (() => { let cb = null; ipcRenderer.on('app-audio-event', (_e, ev) => cb?.(ev)); return (f) => { cb = f; }; })(), // { t: 'waiting' | 'reattached', name }
  sourceState: () => ipcRenderer.invoke('source-state'), // janela transmitida: { kind, exists, minimized, title }
  fseState: () => ipcRenderer.invoke('fse-state'), // { available, state ('d3d_fullscreen'...), fgIsSource, kind }: indício de tela cheia exclusiva
  detectGame: () => ipcRenderer.invoke('detect-game'), // { id, title } | null (desde a 1.0.24)
  // avisos do programa nativo, na hora em que a lista de janelas muda (sem esperar a próxima consulta)
  onGameChanged: (() => { let cb = null; ipcRenderer.on('game-changed', (_e, g) => cb?.(g)); return (f) => { cb = f; }; })(), // { id, title } | null
  onSourceState: (() => { let cb = null; ipcRenderer.on('source-state', (_e, s) => cb?.(s)); return (f) => { cb = f; }; })(), // como sourceState()
  onAppAudio: (() => { let cb = null; ipcRenderer.on('app-audio-data', (_e, b, slot) => cb?.(b, slot | 0)); return (f) => { cb = f; }; })(), // slot: um programa no áudio "só desta tela"
  appAudioScreen: true, // sabe o modo 'screen' (áudio só dos programas da tela transmitida)
  setBadge: (n) => ipcRenderer.send('set-badge', n),
  flashFrame: () => ipcRenderer.send('flash-frame'), // ícone piscando na barra de tarefas (desde a 1.0.40)
  clipFlash: (o) => ipcRenderer.send('clip-flash', o), // aviso de clipe por cima do jogo (desde a 1.0.24)
  onHotkey: (cb) => ipcRenderer.on('hotkey', (_e, k) => cb(k)),
  // atalhos do soundboard no Windows (com o jogo em foco), só enquanto está numa chamada: [{ combo (e.code), id }]; o
  // atalho chega pelo onHotkey como 'sb:<id>' (desde a 1.0.53)
  setSoundKeys: (list) => ipcRenderer.send('sound-keys', list),
  // push-to-talk global (apps com esta função; a página testa se pttSet existe): code = e.code da tecla ou Mouse3/4/5; null desliga. Devolve { ok, reason?, global }
  pttSet: (code) => ipcRenderer.invoke('ptt-set', code),
  onPtt: (cb) => ipcRenderer.on('ptt', (_e, down) => cb(!!down)),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (p) => ipcRenderer.invoke('set-settings', p),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  cacheInfo: () => ipcRenderer.invoke('cache-info'),
  appMetrics: () => ipcRenderer.invoke('app-metrics'), // [{ type, service, cpu (%), mem (bytes) }] (Configurações → Modo leve) // { http: bytes, limitMB } (Configurações → Armazenamento)
  relaunch: () => ipcRenderer.invoke('relaunch'),
  changeServer: () => ipcRenderer.invoke('change-server'),
  testServer: (input) => ipcRenderer.invoke('test-server', input),
  getUpdate: () => ipcRenderer.invoke('get-update'),
  checkUpdate: () => ipcRenderer.invoke('check-update'), // procura e baixa já (desde a 1.0.28)
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)), // download da versão nova: { pct } (desde a 1.0.29)
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'), // relatório de problema (desde a 1.0.23)
  installUpdate: () => ipcRenderer.invoke('install-update'),
  silentUpdate: true, // o app atualiza sem abrir o instalador (só reinicia); a página ajusta os textos
  onUpdate: (cb) => ipcRenderer.on('update-available', (_e, v) => cb(v)),
  saveServer: (url) => ipcRenderer.invoke('save-server', url),
  setThrottle: (on) => ipcRenderer.send('set-throttle', !!on),
  // janela minimizada/na bandeja: { hidden } (desde a 1.0.25). Sem desaceleração o Electron não muda document.hidden sozinho
  onWindowState: (() => { let cb = null, last = null; ipcRenderer.on('win-state', (_e, s) => { last = s; cb?.(s); }); return (f) => { cb = f; if (last) f(last); }; })(),
  // controle remoto: só mouse e teclado, com o programa nativo; ver desktop/remote.js
  remoteCapable: () => ipcRenderer.invoke('remote-capable'),
  remoteStart: (o) => ipcRenderer.invoke('remote-start', o),
  remoteInput: (ev) => ipcRenderer.send('remote-input', ev),
  remoteStop: () => ipcRenderer.send('remote-stop'),
  onRemoteEvent: (cb) => ipcRenderer.on('remote-event', (_e, k) => cb(k)),
  // transmissão a 120 FPS: programa nativo (captura sem limite + placa de vídeo); ver desktop/native.js
  nativeCapable: (mode) => ipcRenderer.invoke('native-capable', mode),
  nativeStart: (o) => ipcRenderer.invoke('native-start', o),
  nativeStop: () => ipcRenderer.send('native-stop'),
  // clipe da própria transmissão nativa: { ok, bytes (Uint8Array), frames, ms } dos últimos `secs` segundos
  nativeClip: (secs) => ipcRenderer.invoke('native-clip', secs),
  nativeClipKeep: (ms) => ipcRenderer.send('native-clip-keep', ms),
  onNativeEvent: (cb) => ipcRenderer.on('native-event', (_e, ev) => cb(ev)),
  // codecs: o Windows tem a Media Foundation (edições "N" vêm sem)? e atalho para instalar (Configurações > Transmissão)
  codecEnv: () => ipcRenderer.invoke('codec-env'),
  openOptionalFeatures: () => ipcRenderer.send('open-optional-features'),
  // Watch Together: janela do serviço com a conta de cada um (desktop/watchwin.js). Eventos: { service, t: 'drm'|'state'|'login'|'error'|'closed'|'seek_unsupported', ... }
  watchOpen: (o) => ipcRenderer.invoke('watch-open', o),
  watchCmd: (service, c) => ipcRenderer.invoke('watch-cmd', service, c),
  watchClose: (service) => ipcRenderer.send('watch-close', service),
  onWatchEvent: (() => { let cb = null; ipcRenderer.on('watch-event', (_e, m) => cb?.(m)); return (f) => { cb = f; }; })(),
});
