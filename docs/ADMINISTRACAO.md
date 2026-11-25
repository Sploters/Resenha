# Administração: saúde, alertas, desempenho e estatísticas

Para quem hospeda a Resenha. As variáveis citadas estão em [CONFIGURACAO.md](CONFIGURACAO.md#saúde-alertas-e-estatísticas).

## Saúde do servidor (monitoramento)
**Configurações → Administração → Saúde do servidor** (só o administrador da instalação; `server/health.js`): situação de processador, memória, disco, servidor de voz e upload; pessoas conectadas e em chamada, transmissões e câmeras; gráficos das últimas 1/6/24 h (CPU, memória, upload, pessoas em chamada e CPU de cada worker do SFU); tabela dos workers (vivo, recriações, pico); tráfego do mês; alertas enviados; erros do servidor (todos também em `<dados>/errors.log`). Atualiza sozinho a cada 30 s.
Alertas no app do administrador e, com `ALERT_WEBHOOK`, no celular (no máximo um por assunto a cada 30 min): CPU acima de `HEALTH_CPU_PCT` (85%) por 1,5 min, memória livre abaixo de `HEALTH_MEM_PCT` (10%), disco com menos de `HEALTH_DISK_PCT` (10%) ou 2 GB, upload acima de 85% de `HEALTH_UPLINK_MBPS` (velocidade do link da VPS; sem ela não alerta), tráfego do mês em 80% de `HEALTH_MONTHLY_TB` (franquia da VPS, ex.: Hostinger), worker do SFU morto ou perto de 100% de um núcleo, e 20 erros em 5 min. `GET /healthz` (público, sem números) responde 503 quando a voz ou o disco caem: aponte um monitor de fora (UptimeRobot, Uptime Kuma) para ser avisado se a VPS inteira cair; a imagem Docker usa o mesmo endereço no `HEALTHCHECK`. Teste: `node scripts/health-test.mjs`.

## Convites de cadastro
Configurações → Administração → **Convites de cadastro** (só o administrador da instalação: `LC_ADMIN` ou a primeira conta).
Escolhe como contas novas entram: **Aberto** (o padrão), **Só com convite** ou **Fechado**. A troca vale na hora, sem
reiniciar nada. No modo convite, cada código tem limite de usos (1, 5, 10, 25 ou sem limite), validade opcional, um recado
para você lembrar para quem foi e, se quiser, um servidor em que a pessoa já entra ao criar a conta. O link
`/convite/<código>` abre a tela de criar conta com o código preenchido. Revogar vale na hora; quem já criou conta continua
com ela. O painel mostra quem criou conta com cada código, e cada ação fica no histórico de Usuários. A primeira conta da
instalação nunca precisa de código. `OPEN_REGISTRATION=0` fecha o cadastro acima do que estiver no painel. Código:
`server/signup.js`, `public/adminusers.js`, teste `scripts/signup-invite-test.mjs`.

## Desempenho
A interface é entregue comprimida e com cache longo (versão do servidor no endereço dos arquivos; ver `docs/historico/AUDITORIA-DESEMPENHO.md`). `STATIC_OFF=1` desliga isso em caso de problema. Medição: `node scripts/perf-audit.mjs <rótulo>` (mais em [DESENVOLVIMENTO.md](DESENVOLVIMENTO.md#desempenho-e-carga)).

**Alerta de lentidão:** resposta acima de 1 s (ou o servidor travando) avisa o administrador da instalação na hora, no app dele; no máximo um aviso por rota a cada 15 min. Para receber no celular mesmo com o app fechado, defina `ALERT_WEBHOOK` com um tópico do [ntfy](https://ntfy.sh) (ex.: `https://ntfy.sh/resenha-seu-topico-secreto`, e assine o tópico no app ntfy) ou um webhook de canal do Discord. `ALERT_MS` muda o limite. Tempos por rota, alertas, velocidade real dos usuários e o atraso do servidor (event loop): `GET /api/perf` (só o administrador).

## Estatísticas de uso
O app conta, sem identificar ninguém, como está sendo usado: pessoas ativas, retenção e o funil de quem é novo, tempos de abrir canal, mandar mensagem e entrar na voz, quedas de conexão, erros do app, idas e voltas rápidas, menus abandonados, buscas sem resultado, funis e cliques com raiva ou sem efeito. Fica tudo no seu servidor, como contagens por dia e versão do app, e é apagado depois de 60 dias. O administrador da instalação vê em Configurações → Administração → Estatísticas de uso (ou `GET /api/ux`). Cada pessoa pode desligar em Privacidade e segurança. `UX_TELEMETRY=0` desliga a coleta no servidor inteiro, e `UX_MIN_COUNT` (padrão 5) é o mínimo de ocorrências para o painel mostrar um termo buscado ou um aviso de erro, para não apontar ninguém em grupos pequenos.

Depois de algumas chamadas (cerca de 5%, no máximo uma vez por semana por aparelho) aparece no canto a pergunta "Teve algum problema na chamada?", que some sozinha. Além disso, **toda chamada** em que chegou a voz de alguém (20 s ou mais) tem a **qualidade técnica medida** pela própria conexão, sem perguntar nada: atraso, perda de pacotes nos dois sentidos, oscilação (jitter), voz picotada, vídeo travando, quedas, UDP ou TCP e relay. Vai só em faixas (ex.: "atraso 100–200 ms"), com uma nota (boa, média, ruim) e o que mais pesou; o painel cruza com a pergunta para separar problema de rede de problema no microfone, no fone ou no app (teste: `node scripts/call-quality-test.mjs`). Toda segunda, a partir das 9 h (hora do servidor), o administrador recebe no app um **resumo da semana** comparado com a anterior: pessoas, contas novas, erros novos, tempos, chamadas, fluxos que caíram e cliques com raiva. Para receber também no celular, defina `UX_DIGEST_WEBHOOK` (ou use o mesmo `ALERT_WEBHOOK`). O painel tem "Enviar agora". Em Privacidade e segurança, "Ver o que é enviado" mostra a lista real do que está na fila e do que já foi enviado.

## Banda e latência
Voz no automático em 64 kbps mono (até 80% menos banda que antes), diagnóstico de conexão no ícone de sinal do painel de voz, e `sh deploy/conexoes.sh` para ver quem liga direto ou por relay na Tailscale. Detalhes e como baixar o ping de quem está longe: [BANDA-E-LATENCIA.md](BANDA-E-LATENCIA.md).

## Relatórios de problema e versões do app
Configurações → Relatar um problema manda o diagnóstico por DM ao administrador da instalação (`LC_ADMIN`). Versão mínima do app desktop para entrar nas calls e como as atualizações chegam: [ATUALIZACOES-E-RELATORIOS.md](ATUALIZACOES-E-RELATORIOS.md).

## Cópias do banco e restauração
O banco (`resenha.db`, SQLite em modo WAL) é aberto com `synchronous=NORMAL`, `foreign_keys`, `busy_timeout` de 5 s e o
`-wal` limitado a 64 MB depois de cada checkpoint (`server/db.js`). Na abertura roda `PRAGMA quick_check` (`DB_CHECK=quick`;
`full` = `integrity_check`, `off` desliga; ~1 s por GB). Banco com problema: os arquivos são copiados como estão para
`<dados>/corrompido-<data>/` (uma vez só), o aviso aparece no console, no `errors.log` e no alerta do administrador, e o
servidor segue (`DB_ON_CORRUPT=stop` para de vez). Arquivo que nem é banco: o servidor não sobe e diz como restaurar.
Ao desligar/atualizar, o banco fecha com checkpoint completo (o `-wal` fica vazio).

**Cópias automáticas** (`server/backup.js`): a cada `BACKUP_HOURS` (24; 0 desliga) em `BACKUP_DIR` (`<dados>/backups`,
no Umbrel `~/resenha-data/backups`), guardando as `BACKUP_KEEP` (7) mais novas. Usa a API de backup do SQLite com o
servidor no ar (nunca copia o arquivo vivo; não usa `VACUUM INTO`, que renumera o rowid de que a busca depende); cada cópia
nasce `.tmp`, é verificada (`quick_check` + tabelas), vira um arquivo só e só então ganha o nome `resenha-<data>-<hora>.db`
(UTC). Cópia que reprova (banco corrompido, disco cheio) é apagada e as boas ficam. Os anexos (`uploads/`) não entram:
copie a pasta de dados inteira de vez em quando. O deploy (`deploy/servidor.sh`) também guarda `~/resenha-backups/data-*.tgz`
a cada troca de container, agora feito com o container **já parado** (as 20 mais novas; `BACKUPS_MANTER`).

    node server/backup.js copiar [dados]                 # cópia agora (pode com o servidor no ar)
    node server/backup.js listar [dados]                 # cópias, da mais nova para a mais velha
    node server/backup.js verificar <arquivo>            # abre e confere (sai com 1 se tiver problema)
    node server/backup.js restaurar <arquivo> [dados]    # só com o servidor parado

**Restaurar** confere a cópia antes de tudo, recusa se o servidor estiver rodando (banco aberto por outro processo ou
`em-chamada.json` recente), guarda o banco atual inteiro em `<dados>/antes-da-restauracao-<data>/` e troca. Também aceita o
`resenha.db` de um `.tgz` do deploy (extraia antes; o `-wal` ao lado entra junto). No Umbrel/Docker:

    docker stop resenha
    docker run --rm -v ~/resenha-data:/data resenha node server/backup.js listar
    docker run --rm -v ~/resenha-data:/data resenha node server/backup.js restaurar /data/backups/resenha-AAAAMMDD-HHMMSS.db
    docker start resenha

Instalação com systemd: `systemctl stop resenha`, `sudo -u resenha DATA_DIR=/var/lib/resenha node server/backup.js restaurar …`
em `/opt/resenha`, `systemctl start resenha`. Teste: `node scripts/backup-unit-test.mjs`.
