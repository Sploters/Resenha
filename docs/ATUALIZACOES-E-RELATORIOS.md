# App desktop: atualizações, versões na call e relatórios de problema

## Atualizações (repositório pode ser privado)
- A cada mudança em `desktop/` na `main`, o GitHub Actions (`.github/workflows/desktop-release.yml`) monta o instalador
  e publica a release (número da versão escolhido sozinho).
- O servidor consulta a release com uma chave **somente leitura** e entrega aos apps (`/api/desktop/update`,
  `/desktop/download/<instalador>`). Chave: arquivo `github-token.txt` na pasta de dados (Umbrel: `~/resenha-data`)
  ou a variável `GITHUB_TOKEN`. Sem chave, só funciona com o repositório público.
- Apps a partir da 1.0.23 perguntam ao servidor; versões anteriores perguntam direto ao GitHub (só com repositório público).

## Segurança das atualizações
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
