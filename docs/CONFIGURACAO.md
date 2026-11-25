# Configuração (variáveis de ambiente)

Tudo é opcional: sem nada, o servidor sobe com os padrões. No Docker, passe com `-e NOME=valor`; com Node, antes do
`npm start`. Como instalar: [INSTALACAO.md](INSTALACAO.md).

## Básico
| Variável | O que faz |
|---|---|
| `PORT`, `HTTPS_PORT`, `HOST` | Portas HTTP (3000) e HTTPS (3443) e endereço onde escutar (padrão `0.0.0.0`). |
| `DATA_DIR` | Pasta de dados (padrão `./data`; no Docker `/data`). O que tem nela: [INSTALACAO.md](INSTALACAO.md#dados-e-cópia-de-segurança). |
| `MAX_UPLOAD_MB` | Limite por arquivo (padrão 500). Vídeo maior é comprimido no aparelho antes de subir. |
| `OPEN_REGISTRATION=0` | Fecha o cadastro de contas novas (acima da escolha do painel). Sem ela, o administrador escolhe em Configurações → Administração → Convites de cadastro: aberto, só com código de convite ou fechado. |
| `HTTPS=0` | Desliga o HTTPS. |
| `TLS_KEY` / `TLS_CERT` | Certificado próprio (sem eles, o servidor gera um autoassinado na pasta de dados). |
| `TLS_SAN=IP:<ip-vpn>` | Acrescenta o IP da VPN ao certificado gerado (vários separados por vírgula). |
| `TURN_URL` / `TURN_SECRET` | Servidor TURN para a voz de quem está fora da VPN (CGNAT): ver [TURN.md](TURN.md). `TURN_URL` aceita vários, separados por vírgula; `TURN_SECRET` é o `static-auth-secret` do coturn (credencial temporária por pessoa). `TURN_USER` / `TURN_PASS`: usuário e senha fixos, para TURN sem segredo. |
| `CSP` | Content-Security-Policy da página (`server/security.js`), a defesa de reserva contra XSS: ligada por padrão; `CSP=report` só avisa no console do navegador (não bloqueia); `CSP=off` desliga. |
| `CSP_EXTRA` | Origens a mais (`"http://host:porta ..."`, separadas por espaço) somadas a script, imagem, mídia, conexão e iframe da CSP (os testes usam para os servidores falsos locais). |

## Contas e sessões
`server/accounts.js`: o banco guarda só o hash (SHA-256) dos tokens de login (bancos antigos são convertidos na primeira
abertura, sem deslogar ninguém). Sessão sem uso há `SESSION_IDLE_DAYS` dias (padrão 30) ou criada há mais de
`SESSION_MAX_DAYS` (padrão 180) expira. Trocar a senha encerra as outras sessões, inclusive as conexões abertas. Login:
5 senhas erradas numa conta → espera que dobra a cada erro (30 s até 15 min); 30 erradas do mesmo IP em 15 min → 15 min
sem tentar. Senha nova (cadastro e troca): 8 a 256 caracteres, diferente do nome de usuário e fora da lista das mais
usadas; senhas antigas continuam valendo. Teste: `node scripts/account-security-test.mjs`.

## Voz (SFU)
| Variável | O que faz |
|---|---|
| `RTC_PORT` | Porta da voz (padrão 40000, UDP+TCP — libere no firewall). |
| `RTC_IPS` | IPs onde escutar; padrão: todos os IPv4 das interfaces, então suba a VPN **antes** do servidor. |
| `RTC_ANNOUNCED_IP` | Em Docker: o IP da VPN do host. |
| `RTC=0` | Desliga o SFU e volta à malha P2P (boa até ~6-8 pessoas por sala). |
| `RTC_NATIVE_PORTS` | Padrão `40001-40010` (UDP): transmissão a 60 e 120 FPS pela placa de vídeo no app desktop no Windows 11 (escolha 60 ou 120 fps em "Transmitir tela"; sem as portas o app volta sozinho ao modo normal; ver [TRANSMISSAO-120FPS.md](TRANSMISSAO-120FPS.md)). |
| `SFU_WORKERS` | Quantos workers do mediasoup (cada um é um processo, 1 núcleo; cada sala fica inteira num worker). Número ou `auto` (núcleos, até 4); padrão 1. |
| `RTC_EXTRA_PORT` | Porta do primeiro worker extra (padrão 40011, depois 40012…); precisa estar aberta como a 40000. |

## Limites de conta e de servidor
Padrões nos números do Discord (`server/limits.js`; a lista completa em [RECURSOS.md](RECURSOS.md)). Cada um muda por
variável: `LIMIT_GUILDS` (100), `LIMIT_FRIENDS` (1.000), `LIMIT_PENDING_OUT` (1.000), `LIMIT_BLOCKED` (5.000),
`LIMIT_ROLES` (250), `LIMIT_CHANNELS` (500), `LIMIT_CATEGORIES` (50), `LIMIT_PER_CATEGORY` (50), `LIMIT_INVITES` (999).

`AUDIT_DAYS`: quantos dias o registro de auditoria guarda (padrão 45). Teste: `node scripts/audit-retention-test.mjs`.

## Tradução
`LIBRETRANSLATE_URL` (+ `LIBRETRANSLATE_KEY`) usa uma instância LibreTranslate sua; sem ela, o servidor usa o endpoint
público não oficial do Google Tradutor (o texto traduzido sai do servidor). `TRANSLATE=0` desliga.

## Jogos e Steam
| Variável | O que faz |
|---|---|
| `STEAM_API_KEY` | Chave da Web API da Steam (só no servidor). Precisa dela para a biblioteca (jogos e horas) e as conquistas; o cartão de link da Steam funciona sem. No `deploy/umbrel.sh`, vai no arquivo `~/resenha-steam.env`. |
| `DEALS_MS` / `DEALS=0` | Intervalo da verificação de promoções da wishlist (padrão 3 h) / desliga (`checkDeals` em `server/games.js`). |
| `OPENCRITIC_KEY` | Chave da [API do OpenCritic](https://rapidapi.com/opencritic-opencritic-default/api/opencritic-api) (RapidAPI, só no servidor). Com ela o popup do jogo mostra a nota da crítica; sem ela o bloco simplesmente não aparece. No `deploy/umbrel.sh`, pode ir no mesmo `~/resenha-steam.env` (linha `OPENCRITIC_KEY=suachave`). |
| `OPENCRITIC_DAILY` | No máximo quantos pedidos por dia ao OpenCritic (padrão 100; o plano grátis é pequeno). Cada jogo fica guardado no banco por 14 dias (3 sem nota), então o mesmo jogo gasta 2 pedidos uma vez só. |
| `ACH_GAMES` | Quantos jogos mais recentes da biblioteca trazem conquistas (padrão 40). |
| `ACH_SYNC=0` | Desliga a sincronização de conquistas a cada 24 h. |
| `GUILD_GAMES_MIN` | Mínimo de pessoas para um jogo aparecer em "Jogam aqui" (padrão 2). |
| `DISCOVER_OFF=1` | Desliga a aba Descobrir (fontes em [DESCOBRIR.md](DESCOBRIR.md)). |

## Watch Together
`YOUTUBE_API_KEY` (opcional): busca pela YouTube Data API; sem ela usa o yt-dlp do bot de música. Detalhes em
[WATCH-TOGETHER.md](WATCH-TOGETHER.md).

## Bot de música
`MUSIC_BOTS` (padrão 4, um por sala), `MUSIC_IDLE_MIN` (minutos parado antes de sair; padrão 5), `MUSIC_ALLOW_ANY=1`
(libera qualquer site), `YTDLP_COOKIES=/data/cookies.txt` (se o YouTube pedir login), `YTDLP_REMOTE_EJS=0`,
`YTDLP_PATH`, `FFMPEG_PATH`. O que instalar: [INSTALACAO.md](INSTALACAO.md#bot-de-música).

## GIFs
Crie uma chave de API de desenvolvedor no site da **KLIPY** ou da **GIPHY** e coloque-a num arquivo na pasta de dados do
servidor: `~/resenha-data/klipy.key` (ou `giphy.key`), depois reinicie o container (`sh deploy/umbrel.sh`). Também vale a
variável `KLIPY_API_KEY` / `GIPHY_API_KEY`. Com as duas, cada pessoa escolhe a fonte (ver [RECURSOS.md](RECURSOS.md#gifs)).

## App desktop
| Variável | O que faz |
|---|---|
| `GITHUB_TOKEN` | Chave somente leitura para o servidor consultar as releases com o repositório privado (ou o arquivo `github-token.txt` na pasta de dados). |
| `DESKTOP_MIN_VERSION` | Versão mínima do app para entrar nas calls (ou o arquivo `desktop-min-version.txt`). |
| `LC_ADMIN` | Nome de usuário do administrador da instalação, que recebe os relatórios de problema (sem ela, a conta mais antiga). |

Detalhes: [ATUALIZACOES-E-RELATORIOS.md](ATUALIZACOES-E-RELATORIOS.md).

## Saúde, alertas e estatísticas
Explicados em [ADMINISTRACAO.md](ADMINISTRACAO.md).
| Variável | O que faz |
|---|---|
| `ALERT_WEBHOOK` | Tópico do [ntfy](https://ntfy.sh) ou webhook de canal do Discord para os alertas chegarem no celular. |
| `NTFY_URL` | Servidor do [ntfy](https://ntfy.sh) usado para os avisos no celular das pessoas ("Bora?" e convites para a call). Padrão `https://ntfy.sh`; use o seu se tiver um ntfy próprio. |
| `PUBLIC_URL` | Endereço oficial do Resenha (ex.: `https://resenha.seudominio.com.br`). Prefira definir em Configurações → Administração → Convites de cadastro → Endereço oficial (vale na hora e fica acima desta variável). Vai nos links que o app gera (convites, QR Code, clipes) e nos avisos do celular. |
| `TRUST_PROXY=0` | Não lê o IP de quem acessa nos cabeçalhos do Cloudflare/proxy (`CF-Connecting-IP`, `X-Forwarded-For`). Por padrão eles valem só quando a conexão vem da própria máquina ou da rede do Docker (onde roda o túnel). |
| `ALERT_MS` | Limite do alerta de lentidão (padrão 1 s). |
| `SLOW_MS` | Respostas acima disso vão para `<dados>/slow.log` (padrão 400 ms). |
| `HEALTH_CPU_PCT`, `HEALTH_MEM_PCT`, `HEALTH_DISK_PCT` | Limites dos alertas de CPU (85%), memória livre (10%) e disco livre (10%). |
| `HEALTH_UPLINK_MBPS` | Velocidade do upload da VPS; sem ela não alerta upload. |
| `HEALTH_MONTHLY_TB` | Franquia mensal de tráfego da VPS (alerta em 80%). |
| `UX_TELEMETRY=0` | Desliga a coleta das estatísticas de uso no servidor inteiro. |
| `UX_MIN_COUNT` | Mínimo de ocorrências para o painel mostrar um termo buscado ou um aviso de erro (padrão 5). |
| `UX_DIGEST_WEBHOOK` | Para onde vai o resumo da semana (sem ela, `ALERT_WEBHOOK`). |
| `STATIC_OFF=1` | Desliga a entrega comprimida e com cache longo da interface, em caso de problema. |
