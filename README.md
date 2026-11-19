# Resenha

Chat + voz + vídeo + transmissão de tela auto-hospedado, com layout inspirado no Discord. O servidor roda em Linux/Umbrel/Docker; os amigos usam o **aplicativo desktop** (Windows) ou o navegador, conectados pela VPN (Tailscale / Hamachi / Radmin). Não usa código nem assets do Discord.

## Recursos
Resumo; a lista completa está em [docs/RECURSOS.md](docs/RECURSOS.md).
- **Servidores:** categorias, canais de texto, voz, fórum, anúncios, galeria e documento; cargos com hierarquia, permissões por categoria e canal, convites, emojis e soundboard do servidor, eventos, registro de auditoria e reputação (anti-spam).
- **Mensagens:** markdown, respostas, reações, menções, anexos grandes (500 MB, retomando se a conexão cair), enquetes, mensagens de voz, tradução, busca em tudo, encaminhar, importar conversa do Discord e apagar as próprias mensagens em massa.
- **DMs** com chamadas de voz/vídeo e **criptografia de ponta a ponta** (mensagens, arquivos e chamadas 1:1).
- **Voz:** SFU no servidor (mediasoup) com malha P2P como reserva, redução de ruído por IA, push-to-talk com o jogo em foco, efeitos de voz, moderação de voz e recuperação automática da conexão.
- **Transmissão de tela** até 1440p/original, áudio só do jogo, 60/120 FPS pela placa de vídeo no app desktop, clipes (F8) com galeria e controle remoto.
- **Atividades na chamada:** Watch Together (YouTube, links e sincronização assistida de Netflix/Prime/Crunchyroll) e bot de música (YouTube, Spotify, SoundCloud…).
- **Jogos:** "Jogando…" pelo PC, cartão da Steam, biblioteca e wishlist com alerta de promoção, conquistas, "O que jogar hoje?", LFG e "A fim de jogar", painel "Ativo agora" com a semana da galera.
- **App desktop:** bandeja, atalhos globais, modo leve automático com o jogo aberto, atualização automática assinada.
- **Para quem hospeda:** saúde do servidor com alertas no celular, estatísticas de uso anônimas, limites e expiração de arquivos.

## Requisitos
- Docker (Linux/Umbrel) ou Node.js >= 22.5 (usa `node:sqlite`) e `openssl`. No Docker/Umbrel já vem tudo no `Dockerfile`.
- Portas: 3000 e 3443 (TCP), 40000 (UDP+TCP, voz) e 40001-40010 (UDP, transmissão a 60/120 FPS).
- Bot de música: yt-dlp e ffmpeg (já na imagem Docker).

## Instalar e rodar
Detalhes e variáveis: [docs/INSTALACAO.md](docs/INSTALACAO.md) e [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md).

**Docker:**

    docker build -t resenha .
    docker run -d --restart=always -p 3000:3000 -p 3443:3443 -p 40000:40000/udp -p 40000:40000/tcp -v ~/resenha-data:/data -e TLS_SAN=IP:<ip-vpn> -e RTC_ANNOUNCED_IP=<ip-vpn> resenha

**Umbrel (ou outro servidor por SSH):** `sh deploy/umbrel.sh usuario@ip-da-vpn` envia o código, monta a imagem, guarda uma cópia do banco e recria o container (o endereço também pode ficar em `deploy/servidor.conf`, com `SERVIDOR=usuario@ip-da-vpn`).

**Node:**

    npm install --omit=dev
    npm start            # HTTP :3000 e HTTPS :3443

## Atualizar sem derrubar a chamada
`sh deploy/umbrel.sh` monta a imagem nova e, se houver gente em chamada, **espera a sala esvaziar** antes de trocar o container (reiniciar derruba todo mundo por ~6 s). `FORCAR=1` troca na hora; `ESPERA_MAX=30` desiste depois de 30 min (padrão 120). Na troca, os apps mostram "Servidor atualizando. Volta em alguns segundos…". Sem o script: reconstrua a imagem e recrie o container com o mesmo volume (o banco migra sozinho).

## VPN
Exponha o servidor só pela VPN (Tailscale, Hamachi, Radmin). Suba a VPN **antes** do servidor (a voz escuta nos IPs das interfaces), libere a porta 40000 UDP+TCP no firewall e, em Docker, passe o IP da VPN em `TLS_SAN=IP:<ip-vpn>` (certificado HTTPS autoassinado, necessário para microfone, câmera e tela) e `RTC_ANNOUNCED_IP=<ip-vpn>`.

## App desktop (Windows)
Cada mudança em `desktop/` ou `native/` na `main` publica uma release no GitHub com `Resenha-Setup-<versão>.exe` e `Resenha-Portable-<versão>.exe`; o servidor também entrega o instalador em `/desktop/download/<instalador>`. No primeiro uso o app pede o endereço do servidor (IP da VPN). Depois ele procura versão nova ao abrir e de hora em hora e oferece "Atualizar agora / Depois", instalando só o que tem a assinatura certa. Repositório privado: o servidor precisa de uma chave somente leitura (`github-token.txt` na pasta de dados ou `GITHUB_TOKEN`). Mais em [docs/ATUALIZACOES-E-RELATORIOS.md](docs/ATUALIZACOES-E-RELATORIOS.md).

## Dados e cópia de segurança
Tudo fica na pasta de dados (`DATA_DIR`; no Docker `/data`, no Umbrel `~/resenha-data`): o banco `resenha.db`, os arquivos enviados (`uploads/`), o certificado e as chaves opcionais. Faça cópia dela. O `deploy/umbrel.sh` guarda uma cópia do banco em `~/resenha-backups/` antes de cada troca de container. Lista completa em [docs/INSTALACAO.md](docs/INSTALACAO.md#dados-e-cópia-de-segurança).

## Documentação
- [docs/README.md](docs/README.md): índice de toda a documentação.
- [docs/DESENVOLVIMENTO.md](docs/DESENVOLVIMENTO.md): scripts, testes e verificação automática.
- [docs/ADMINISTRACAO.md](docs/ADMINISTRACAO.md): saúde do servidor, alertas e estatísticas.
- [PRIVACIDADE.md](PRIVACIDADE.md): o que o servidor guarda, quem vê e o que sai dele (nada é vendido nem usado para treinar IA).
- [SECURITY.md](SECURITY.md): como relatar uma falha de segurança.
