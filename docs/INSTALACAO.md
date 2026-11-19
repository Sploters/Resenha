# Instalação, atualização e dados

Como subir o servidor da Resenha, deixar os amigos entrarem pela VPN, atualizar sem derrubar a chamada e guardar os dados.
As variáveis de ambiente ficam em [CONFIGURACAO.md](CONFIGURACAO.md).

## Requisitos
- **Servidor:** Linux, Umbrel ou qualquer máquina com Docker. Sem Docker: Node.js >= 22.5 (usa `node:sqlite`) e `openssl`.
  No Docker/Umbrel já vem tudo no `Dockerfile`.
- **Portas:** 3000 (HTTP) e 3443 (HTTPS) TCP; 40000 UDP+TCP (voz, `RTC_PORT`); 40001-40010 UDP (transmissão a 60/120 FPS
  pelo app desktop, `RTC_NATIVE_PORTS`). Cada worker extra do SFU (`SFU_WORKERS`) usa mais uma porta a partir da 40011
  (`RTC_EXTRA_PORT`), que precisa estar aberta como a 40000.
- **Bot de música:** yt-dlp e ffmpeg (a imagem Docker já traz; fora dela, ver [Bot de música](#bot-de-música)).
- **Amigos:** o app desktop (Windows) ou o navegador, na mesma VPN do servidor (Tailscale / Hamachi / Radmin).

## Rodar com Node

    npm install --omit=dev
    npm start            # HTTP :3000 e HTTPS :3443

Os dados vão para `./data` (ou `DATA_DIR`).

## Rodar com Docker

    docker build -t resenha .
    docker run -d --restart=always -p 3000:3000 -p 3443:3443 -p 40000:40000/udp -p 40000:40000/tcp -v ~/resenha-data:/data -e TLS_SAN=IP:<ip-vpn> -e RTC_ANNOUNCED_IP=<ip-vpn> resenha

Para a transmissão a 60/120 FPS, publique também `-p 40001-40010:40001-40010/udp` (o `deploy/umbrel.sh` já faz).
A imagem usa `/data` como pasta de dados e tem `HEALTHCHECK` em `/healthz`.

Atualizar à mão: reconstrua a imagem e recrie o container com o mesmo volume (o banco migra sozinho).

## Umbrel (ou outro servidor por SSH): `deploy/umbrel.sh`

    sh deploy/umbrel.sh usuario@ip-da-vpn [ip-da-vpn]

O endereço do servidor não fica no repositório: passe como argumento ou crie `deploy/servidor.conf` (ignorado pelo git)
com a linha `SERVIDOR=usuario@ip-da-vpn`. Requer chave SSH no servidor e o usuário no grupo docker.

O script envia o código, monta a imagem (`docker build`), faz **cópia do banco** em `~/resenha-backups/` e recria o
container `resenha` com a pasta `~/resenha-data`, as portas da voz e da transmissão nativa, `TLS_SAN` e `RTC_ANNOUNCED_IP`
com o IP da VPN. Arquivos opcionais no servidor que ele usa:
- `~/resenha-data/cookies.txt`: cookies do YouTube para o bot de música (`YTDLP_COOKIES`).
- `~/resenha-steam.env`: fora do repositório e da pasta de dados, com a linha `STEAM_API_KEY=suachave` (crie em
  steamcommunity.com/dev/apikey). Liga a biblioteca e as conquistas da Steam.

### Atualizar sem derrubar a chamada
`sh deploy/umbrel.sh` monta a imagem nova e, se houver gente em chamada, **espera a sala esvaziar** antes de trocar o
container (reiniciar derruba todo mundo por ~6 s). O servidor grava a contagem em `~/resenha-data/em-chamada.json` a cada
10 s (só números, sem nomes). `FORCAR=1` troca na hora; `ESPERA_MAX=30` desiste depois de 30 min (padrão 120; a imagem
nova fica pronta). Na troca, o servidor avisa os apps antes de fechar e eles mostram "Servidor atualizando. Volta em
alguns segundos…" em vez de "Conexão perdida". No painel de estatísticas, as quedas por atualização aparecem separadas
das quedas de rede.

    FORCAR=1 sh deploy/umbrel.sh      # troca na hora mesmo com gente em chamada
    ESPERA_MAX=30 sh deploy/umbrel.sh # desiste depois de 30 min esperando

## Acesso pela VPN
Exponha o servidor só pela VPN (Tailscale, Hamachi, Radmin). Os amigos entram pelo IP da VPN do servidor.
- **HTTPS:** microfone, câmera e tela exigem HTTPS fora de localhost. Na primeira vez o servidor cria um certificado
  autoassinado na pasta de dados (`key.pem`/`cert.pem`) com os IPs da máquina; `TLS_SAN=IP:<ip-vpn>` acrescenta o IP da
  VPN (necessário no Docker). Certificado próprio: `TLS_KEY`/`TLS_CERT`.
- **Voz (SFU):** libere `RTC_PORT` (padrão 40000, UDP+TCP) no firewall. `RTC_IPS` (IPs onde escutar) tem como padrão
  todos os IPv4 das interfaces, então suba a VPN **antes** do servidor. Em Docker, `RTC_ANNOUNCED_IP` = o IP da VPN do host.
- Quem liga direto ou por relay na Tailscale: `sh deploy/conexoes.sh` (ver [ADMINISTRACAO.md](ADMINISTRACAO.md#banda-e-latência)).

## Bot de música
Áudio: yt-dlp (sem anúncios) → ffmpeg (Opus) → SFU de voz. O **YouTube exige resolver um desafio em JavaScript**: a imagem
Docker usa o `yt-dlp_linux` (standalone, já com o script EJS) e o Node da própria imagem; sem isso o YouTube responde 403.
Fora do Docker, instale `pip install -U "yt-dlp[default]"` (ou deixe `YTDLP_REMOTE_EJS` ligado, que baixa o script do
GitHub). O `deploy/umbrel.sh` baixa o yt-dlp mais novo a cada dia de deploy — se o YouTube parar de funcionar, refaça o
deploy. Requer o SFU de voz ativo. Variáveis em [CONFIGURACAO.md](CONFIGURACAO.md#bot-de-música).

## App desktop (Windows)
- **Baixar:** cada mudança em `desktop/` na `main` gera uma release no GitHub com `Resenha-Setup-<versão>.exe`
  (instalador) e `Resenha-Portable-<versão>.exe`. O servidor também entrega o instalador em `/desktop/download/<instalador>`.
- **Primeiro uso:** o app pede o endereço do servidor (IP da VPN).
- **Atualizar:** os apps procuram a versão nova ao abrir e de hora em hora e mostram "Atualizar agora / Depois"; só
  instalam o que tem a assinatura certa. Com o repositório privado, o servidor precisa de uma chave somente leitura
  (`github-token.txt` na pasta de dados ou `GITHUB_TOKEN`). Detalhes, versão mínima para entrar nas calls e relatório de
  problema: [ATUALIZACOES-E-RELATORIOS.md](ATUALIZACOES-E-RELATORIOS.md).
- **Montar à mão:** `cd desktop && npm install && npm run dist` (instaladores em `desktop/dist/`). O controle remoto usa
  o programa nativo `native/lc-input` (Rust); o `.exe` já compilado está em `desktop/native/` e entra no instalador.

## Dados e cópia de segurança
Tudo fica na pasta de dados (`DATA_DIR`; Docker: `/data`, no Umbrel `~/resenha-data`). Faça cópia dela: tem o banco e os arquivos.
- `resenha.db` (banco SQLite) e `uploads/` (anexos, clipes, emojis, sons, ícones);
- `key.pem`/`cert.pem` (certificado HTTPS gerado na primeira vez);
- `errors.log` (erros do servidor), `slow.log` (respostas lentas), `reports/` (relatórios de problema), `traffic.json`
  (tráfego do mês), `em-chamada.json` (contagem para o deploy);
- chaves e ajustes opcionais: `klipy.key`/`giphy.key`, `github-token.txt`, `cookies.txt`, `desktop-min-version.txt`,
  `discover.json` (ver [DESCOBRIR.md](DESCOBRIR.md)); `desktop/` guarda o instalador baixado do GitHub.

O `deploy/umbrel.sh` guarda uma cópia do banco (`resenha.db*`, sem os anexos) em
`~/resenha-backups/data-<data>-<hora>.tgz` antes de cada troca de container. Os anexos (`uploads/`) ficam só na pasta de dados.
