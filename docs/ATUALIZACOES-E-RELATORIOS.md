# Atualizações (servidor, interface e app desktop), versões na call e relatórios de problema

## Atualizar o servidor sem derrubar ninguém
Modelo do Discord: nenhuma atualização exige que as pessoas saiam da chamada, e a interface de quem não recarrega a página
também chega. Três peças:

**1. Interface sem reiniciar.** Quase toda mudança é só em `public/`. O deploy (`deploy/servidor.sh`) compara o hash do
código do servidor (tudo que entra na imagem menos `public/`) com o que está no ar (`~/.resenha-deploy/rodando`). Igual:
copia `public/` para dentro do container e manda `SIGHUP`. O servidor (`server/static.js` `reload`) recalcula a versão,
minifica de novo e avisa as páginas abertas (`UI_VERSION`; a versão também vai no `READY` e na `<meta name="lc-ui">`).
A versão anterior continua servida em memória (`?v=<anterior>`), para uma página velha que abre uma tela sob demanda
não misturar módulos novos e velhos.

**2. A página recarrega quando não atrapalha** (`public/uiupdate.js`):
- fora de chamada: com a janela escondida/minimizada ou 10 min sem mexer;
- em chamada **parada** (pergunta ao servidor, `/api/voice/quiet`): recarrega e volta sozinha para a chamada, com o
  mesmo mudo/ensurdecido. Fecha a conexão com o código 4002: o servidor avisa a saída com `reason: 'reload'` e os outros
  não ouvem o som de sair e entrar (`public/sounds.js` segura o som por 30 s; a volta anula);
- chamada com conversa: espera. Pendente há mais de 24 h, recarrega de madrugada (3 h às 6 h, hora do aparelho) com a
  pessoa longe do aparelho;
- com a pessoa usando: cartão "Versão nova do Resenha" com "Recarregar agora" e "Depois". Rascunhos ficam guardados.

**3. Servidor reinicia só sem conversa acontecendo.** Chamada **ativa** (`callActive` em `server/index.js`): 2+ pessoas
e (alguém falou nos últimos 15 min, `CALL_ACTIVE_MS`, medido no SFU pelo `AudioLevelObserver`; alguém entrou há menos
que isso; ou alguém transmite a tela). Pessoa sozinha ou gente dormindo em silêncio não conta: para ela a queda de ~6 s
com volta automática não faz diferença. Sem SFU (voz P2P), 2+ pessoas contam como ativa.
`em-chamada.json` traz `ativas` e `emAtivas`. Com chamada ativa, o deploy deixa uma espera em segundo plano no servidor
(`~/.resenha-deploy/espera.log`; um deploy novo substitui a anterior) que troca quando a conversa parar, ou de
madrugada (`FUSO`, padrão America/Sao_Paulo) depois de `ESPERA_HORAS` (24) pendente. `FORCAR=1` troca na hora.
A primeira vez com este deploy sempre reinicia o servidor (ainda não há `rodando`).
Teste: `node scripts/uiupdate-test.mjs`.

Ainda não feito (o passo seguinte, se reinícios do servidor continuarem frequentes): a voz (mediasoup) num processo
próprio, como os servidores de voz do Discord, para mudanças no servidor também não tocarem nas chamadas. A retomada da
sessão de voz (`VOICE_RESUME`) já existe e seria a base disso.

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
