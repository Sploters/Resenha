# Atualizações (servidor, interface e app desktop), versões na call e relatórios de problema

## Atualizar o servidor sem derrubar ninguém
Modelo do Discord: nenhuma atualização exige que as pessoas saiam da chamada, e a interface de quem não recarrega a página
também chega. A voz roda num processo próprio, e o deploy (`deploy/servidor.sh`) escolhe o menor reinício possível.

### Voz num processo próprio (`server/voz.js`)
O container (e o `deploy/resenha.service`) roda `node server/voz.js`: o **processo da voz** sobe o SFU (mediasoup: salas,
transportes, as portas 40000 e 40001-40010) e roda o **app** (`server/index.js`: site, gateway, banco) como processo filho.
Os dois conversam por IPC: o app usa `server/sfuapi.js`, que no modo separado é `server/sfuproxy.js` (cada operação do SFU
vira um pedido; as consultas síncronas leem o estado que a voz manda a cada 2 s).
- **Reiniciar o app não derruba ninguém.** A voz, a câmera e a transmissão vão do app de cada pessoa direto às portas do
  SFU, que continuam abertas. O app manda à voz um retrato do estado das salas (mudo, tela, cargos…) a cada 3 s e ao
  encerrar; o app novo pega dali quem está em cada sala (`restoreVoice`), segura o lugar de cada um por
  `VOICE_RESTORE_GRACE_MS` (60 s) e cada app retoma a própria sessão (`VOICE_RESUME`). Para os outros, ninguém saiu.
  Medido com Docker de verdade, duas pessoas conversando: maior intervalo sem áudio de ~0,4 s durante o reinício.
- **O que vive no app e acaba no reinício:** bot de música e "assistir junto" (o deploy espera por eles), controle remoto,
  quadro/destaque da sala e a lista de quem assiste cada transmissão (refeita conforme as pessoas voltam).
- **Sinais para o processo da voz:** `SIGUSR2` reinicia só o app (com o código que estiver no disco); `SIGHUP` troca só a
  interface; `SIGTERM` encerra tudo. Se o app cair sozinho, volta em 1 s, 2 s, 5 s… e as chamadas continuam.
  No systemd: `systemctl kill --kill-whom=main -s USR2 resenha` (sem `--kill-whom=main` o sinal vai também para o app e
  os processos do mediasoup).
- **Proteção:** quem está numa sala da voz e não aparece no retrato do app há mais de 3 min sai de lá (ninguém fica
  "fantasma" ocupando a sala).
- `node server/index.js` sozinho continua funcionando com o SFU no mesmo processo (desenvolvimento e quase todos os
  testes). Teste do modo separado: `node scripts/voz-processo-test.mjs` (reinício pelo deploy e `kill -9` do app no meio da
  chamada).

### Os três níveis do deploy
O deploy compara o hash do que mudou com o que está no ar (`~/.resenha-deploy/rodando-voz` e `rodando-app`):

| Mudou | O que acontece | Espera por |
|---|---|---|
| só `public/` | copia para dentro do container e manda `SIGHUP`; nada reinicia | nada |
| `server/` (menos a voz) | copia para dentro do container e manda `SIGUSR2`: só o app reinicia (~2 s) | bot de música ou "assistir junto" tocando (`sessoes`) |
| `server/voz.js`, `server/sfu.js`, dependências ou `Dockerfile` (ou primeira vez) | troca o container: as chamadas caem por ~6 s e voltam sozinhas | chamada **ativa** ou `sessoes` |

Com espera, ela fica em segundo plano no servidor (`~/.resenha-deploy/espera.log`; um deploy novo substitui a anterior)
e aplica quando liberar, ou de madrugada (`FUSO`, padrão America/Sao_Paulo) depois de `ESPERA_HORAS` (24) pendente.
`FORCAR=1` troca o container na hora. **A primeira vez com este deploy sempre troca o container.**

Chamada **ativa** (`callActive` em `server/index.js`): 2+ pessoas e (alguém falou nos últimos 15 min, `CALL_ACTIVE_MS`,
medido no SFU pelo `AudioLevelObserver`; alguém entrou há menos que isso; ou alguém transmite a tela). Pessoa sozinha ou
gente dormindo em silêncio não conta. Sem SFU (voz P2P), 2+ pessoas contam como ativa. `em-chamada.json` traz `ativas`,
`emAtivas` e `sessoes`.

### A interface nova chega a todo mundo
O servidor (`server/static.js` `reload`) recalcula a versão, minifica de novo e avisa as páginas abertas (`UI_VERSION`;
a versão também vai no `READY` e na `<meta name="lc-ui">`). A versão anterior continua servida em memória
(`?v=<anterior>`), para uma página velha que abre uma tela sob demanda não misturar módulos novos e velhos.
A página recarrega quando não atrapalha (`public/uiupdate.js`):
- fora de chamada: com a janela escondida/minimizada ou 10 min sem mexer;
- em chamada **parada** (pergunta ao servidor, `/api/voice/quiet`): recarrega e volta sozinha para a chamada, com o
  mesmo mudo/ensurdecido. Fecha a conexão com o código 4002: o servidor avisa a saída com `reason: 'reload'` e os outros
  não ouvem o som de sair e entrar (`public/sounds.js` segura o som por 30 s; a volta anula);
- chamada com conversa: espera. Pendente há mais de 24 h, recarrega de madrugada (3 h às 6 h, hora do aparelho) com a
  pessoa longe do aparelho;
- com a pessoa usando: cartão "Versão nova do Resenha" com "Recarregar agora" e "Depois". Rascunhos ficam guardados.
Teste: `node scripts/uiupdate-test.mjs`.

## App desktop: atualizações (repositório pode ser privado)
- A cada mudança em `desktop/` (ou em `native/lc-input`, `native/lc-stream`, `native/lc-audio`) na `main`, o GitHub
  Actions (`.github/workflows/desktop-release.yml`) compila os programas nativos, monta o instalador
  e publica a release (número da versão escolhido sozinho).
- O servidor consulta a release com uma chave **somente leitura** e entrega aos apps (`/api/desktop/update`,
  `/desktop/download/<instalador>`). Chave: arquivo `github-token.txt` na pasta de dados (Umbrel: `~/resenha-data`)
  ou a variável `GITHUB_TOKEN`. Sem chave, só funciona com o repositório público.
- Apps a partir da 1.0.23 perguntam ao servidor; versões anteriores perguntam direto ao GitHub (só com repositório público).

## App desktop: segurança das atualizações
- **Assinatura:** o GitHub Actions assina cada instalador (Ed25519) com a chave privada guardada no segredo
  `DESKTOP_UPDATE_KEY` do repositório e publica `Resenha-Setup-X.exe.sig` junto. O app só instala se a assinatura conferir
  com a chave pública embutida (`desktop/updatekey.js`): nome, versão, tamanho e SHA-256 do arquivo baixado. Servidor
  invadido, release adulterada ou alguém no meio da rede não conseguem fazer o app rodar outra coisa (nem um instalador
  antigo apresentado como novo: a versão faz parte do que é assinado). Sem o segredo, a release não é publicada.
- **Só HTTPS:** consulta e download da atualização recusam `http://` (inclusive redirecionamento). Num servidor `http://`
  o app procura direto no GitHub.
- **Certificado do servidor:** certificado válido (Let's Encrypt etc.) passa normalmente. Autoassinado só passa se for o
  mesmo visto quando a pessoa confirmou o servidor na tela de conexão (impressão digital SHA-256 em `config.json`,
  `certPins`). Instalações antigas guardam o da primeira conexão. Se mudar, a página não carrega e a tela de conexão avisa;
  confirmar o endereço de novo (dois cliques) aceita o novo e o app reabre.
- Chaves: `node scripts/update-sign.mjs keygen` gera um par; `verify <instalador>` confere um arquivo.
  Teste: `UPDATE_KEY_FILE=<chave privada> node scripts/update-security-test.mjs` (Electron de verdade).

## Versões na call
- Cada app desktop informa a versão ao conectar. Na sala de voz, quem está com o app desatualizado ganha um selinho
  amarelo com a versão (lista da sala e quadro da call), e quem está na sala recebe um aviso.
- **Versão mínima (opcional):** arquivo `desktop-min-version.txt` na pasta de dados (ex.: `1.0.23`) ou a variável
  `DESKTOP_MIN_VERSION`. Apps abaixo dela não entram nas calls e veem "Atualize o app para entrar na call", com o botão
  de atualizar. O chat continua funcionando. Quem usa pelo navegador não é afetado. Vale na hora (sem reiniciar).

## Relatório de problema
- Configurações → **Relatar um problema**: descrição + diagnóstico (versões, placa de vídeo, log do app desktop, estado
  da call, erros recentes da página; sem senha, token ou mensagens). Dá para ver tudo antes de enviar ou salvar em arquivo.
- Vai por **DM ao administrador da instalação**, com o `.json` anexado, e uma cópia fica em `<dados>/reports`.
  Administrador: variável `LC_ADMIN` (nome de usuário); sem ela, a conta mais antiga.
- Teste: `node scripts/appver-test.mjs`.
