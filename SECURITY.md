# Segurança

## Como relatar uma falha
Achou uma falha de segurança (alguém lendo o que não deveria, entrando na conta de outro, passando por cima de uma permissão, travando o servidor de propósito etc.)?

1. **Não abra uma issue pública.** Use o relato privado do GitHub: aba **Security** do repositório → **Report a vulnerability**. Se não tiver acesso, fale direto com o dono do repositório.
2. Conte o que acontece, como reproduzir (passo a passo ou um script) e o que alguém conseguiria fazer com isso.
3. Se puder, diga a versão (Configurações → Sobre) e se é no app desktop, no navegador ou no servidor.

## O que esperar
- **Resposta em até 7 dias** dizendo se a falha foi confirmada.
- Correção priorizada acima de qualquer recurso novo. Falhas graves (ler mensagens alheias, tomar conta, executar código no servidor) entram numa atualização assim que corrigidas.
- A correção sai com um teste automático que reproduz a falha, para ela não voltar.
- Quem relatou é avisado quando a correção sair e, se quiser, recebe o crédito nas Novidades.
- Nenhum relato é ignorado: mesmo quando não é falha, você recebe a explicação.

## O que está dentro
- Servidor (`server/`), app web (`public/`), app desktop (`desktop/`) e os programas nativos (`native/`).
- A criptografia das DMs (`server/e2ee.js`, `public/e2ee.js`, `public/e2ee-worker.js`).

Fora: falhas de serviços de terceiros (Steam, KLIPY, YouTube, VPNs) e problemas que dependem de alguém já ter acesso ao servidor ou ao aparelho da vítima. Na dúvida, relate assim mesmo.

## Para quem hospeda
- Mantenha a Resenha atualizada (`sh deploy/umbrel.sh` espera a chamada esvaziar antes de trocar).
- Exponha o servidor só pela VPN (Tailscale, Hamachi, Radmin), como no README.
- Faça cópia da pasta de dados (`DATA_DIR`): ela tem o banco e os arquivos.

O que o servidor guarda e o que sai dele está em [`PRIVACIDADE.md`](PRIVACIDADE.md).
