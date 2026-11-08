// Teste de carga do Resenha com o k6 (https://k6.io): 100 pessoas usando ao mesmo tempo, depois 1000.
// Cada pessoa (VU) abre o app como o app de verdade: conecta no WebSocket (/gateway) e espera o READY; depois, enquanto
// estiver "online", carrega mensagens de um canal a cada ~10 s, abre um perfil a cada ~20 s e manda uma mensagem a
// cada ~30 s (que o servidor entrega a todo mundo do servidor: o pior caso).
//
// Preparar (no computador do servidor, com o Resenha PARADO, numa pasta de dados de teste — nunca a de verdade):
//   DATA_DIR=./.loaddata node scripts/load/seed.mjs 1000
//   DATA_DIR=./.loaddata PORT=3000 node server/index.js
// Rodar (de outro computador, de preferência; k6 >= 0.54):
//   k6 run -e BASE=http://IP-DO-SERVIDOR:3000 scripts/load/k6-resenha.js
//   só a fase de 100:  k6 run -e BASE=... -e MAX=100 scripts/load/k6-resenha.js
// Ler o resultado: http_req_duration (API), resenha_ready_ms (abrir o app), resenha_msg_entrega_ms (mensagem chegar
// nos outros) e os "thresholds" no fim (✓ aguentou / ✗ engasgou). Onde engasgou: GET /api/perf (servidor_ms por rota e
// event_loop_ms) e <dados>/slow.log.
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = __ENV.BASE || 'http://localhost:3000';
const MAX = +(__ENV.MAX || 1000);
const N = +(__ENV.USERS || 1000); // pessoas criadas pelo seed.mjs (tokens load-0 … load-N-1)
const ready = new Trend('resenha_ready_ms', true), entrega = new Trend('resenha_msg_entrega_ms', true);
const wsFalhou = new Rate('resenha_ws_falhou'), msgs = new Counter('resenha_mensagens_recebidas');

export const options = {
  scenarios: {
    pessoas: {
      executor: 'ramping-vus', startVUs: 0, gracefulRampDown: '20s',
      stages: MAX <= 100
        ? [{ duration: '1m', target: 100 }, { duration: '3m', target: 100 }, { duration: '30s', target: 0 }]
        : [{ duration: '1m', target: 100 }, { duration: '2m', target: 100 }, // fase 1: 100 pessoas
          { duration: '3m', target: MAX }, { duration: '4m', target: MAX }, // fase 2: sobe até 1000 e segura
          { duration: '1m', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],            // 95% das chamadas em menos de 1 s
    http_req_failed: ['rate<0.01'],               // menos de 1% de erro
    resenha_ready_ms: ['p(95)<3000'],             // abrir o app em menos de 3 s
    resenha_msg_entrega_ms: ['p(95)<1000'],       // mensagem chega nos outros em menos de 1 s
    resenha_ws_falhou: ['rate<0.01'],
  },
};

export function setup() {
  const r = http.get(`${BASE}/api/server-info`); check(r, { 'servidor no ar': (x) => x.status === 200 });
}

export default function () {
  const i = (exec.vu.idInTest - 1) % N, token = `load-${i}`, auth = { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };
  let channels = [], members = [];
  const t0 = Date.now(), online = 120 + Math.random() * 120; // fica online de 2 a 4 min, sai e volta (como gente de verdade)
  const res = ws.connect(`${BASE.replace(/^http/, 'ws')}/gateway?token=${token}`, {}, (socket) => {
    socket.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'READY') {
        ready.add(Date.now() - t0);
        const g = m.d.guilds[0]; channels = g.channels.filter((c) => c.type === 0).map((c) => c.id); members = g.members.map((x) => x.user_id);
        // ações do dia a dia, enquanto está online
        socket.setInterval(() => { const c = channels[Math.floor(Math.random() * channels.length)]; http.get(`${BASE}/api/channels/${c}/messages?limit=50`, Object.assign({ tags: { name: 'GET mensagens' } }, auth)); }, 10000 + Math.random() * 4000);
        socket.setInterval(() => { const u = members[Math.floor(Math.random() * members.length)]; http.get(`${BASE}/api/users/${u}`, Object.assign({ tags: { name: 'GET perfil' } }, auth)); }, 20000 + Math.random() * 8000);
        socket.setInterval(() => {
          const c = channels[Math.floor(Math.random() * channels.length)];
          http.post(`${BASE}/api/channels/${c}/messages`, JSON.stringify({ content: `carga ${i} @${Date.now()}` }), Object.assign({ tags: { name: 'POST mensagem' } }, auth));
        }, 30000 + Math.random() * 10000);
      }
      if (m.t === 'MESSAGE_CREATE') { msgs.add(1); const at = /@(\d{13})$/.exec(m.d.content || ''); if (at) entrega.add(Date.now() - +at[1]); }
    });
    socket.on('error', () => wsFalhou.add(1));
    socket.setTimeout(() => socket.close(), online * 1000);
  });
  wsFalhou.add(!(res && res.status === 101));
  sleep(1 + Math.random() * 3);
}
