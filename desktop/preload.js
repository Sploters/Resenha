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
  detectGame: () => ipcRenderer.invoke('detect-game'), // { id, title } | null (desde a 1.0.24)
  // avisos do programa nativo, na hora em que a lista de janelas muda (sem esperar a próxima consulta)
  onGameChanged: (() => { let cb = null; ipcRenderer.on('game-changed', (_e, g) => cb?.(g)); return (f) => { cb = f; }; })(), // { id, title } | null
  onSourceState: (() => { let cb = null; ipcRenderer.on('source-state', (_e, s) => cb?.(s)); return (f) => { cb = f; }; })(), // como sourceState()
  onAppAudio: (() => { let cb = null; ipcRenderer.on('app-audio-data', (_e, b) => cb?.(b)); return (f) => { cb = f; }; })(),
  setBadge: (n) => ipcRenderer.send('set-badge', n),
  clipFlash: (o) => ipcRenderer.send('clip-flash', o), // aviso de clipe por cima do jogo (desde a 1.0.24)
  onHotkey: (cb) => ipcRenderer.on('hotkey', (_e, k) => cb(k)),
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
  nativeCapable: () => ipcRenderer.invoke('native-capable'),
  nativeStart: (o) => ipcRenderer.invoke('native-start', o),
  nativeStop: () => ipcRenderer.send('native-stop'),
  onNativeEvent: (cb) => ipcRenderer.on('native-event', (_e, ev) => cb(ev)),
});
