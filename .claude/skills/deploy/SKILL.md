---
name: deploy
description: Atualiza o servidor do Resenha (Umbrel) com o código desta pasta, pelo deploy/umbrel.sh, sem derrubar quem está em chamada; também mostra se há atualização esperando no servidor. Use quando o usuário pedir para atualizar, publicar ou fazer o deploy do servidor, ou perguntar se a atualização já entrou.
argument-hint: "[status | forcar]"
---

# Deploy do Resenha

O deploy é `sh deploy/umbrel.sh`. Ele empacota os arquivos **desta pasta** (como estão no disco, inclusive o que não foi
commitado), manda por SSH para o servidor e faz o menor reinício possível (detalhes em `deploy/servidor.sh` e
`docs/ATUALIZACOES-E-RELATORIOS.md`):

| Mudou | O que acontece | Espera por |
|---|---|---|
| só `public/` | nada reinicia; cada página recarrega quando não atrapalha | nada |
| `server/` (menos a voz) | só o app reinicia (~2 s); as chamadas continuam | bot de música ou "assistir junto" tocando |
| `server/voz.js`, `server/sfu.js`, dependências, `Dockerfile` (ou primeira vez) | troca o container: as chamadas caem por ~6 s e voltam sozinhas | conversa acontecendo em alguma chamada |

Quando algo segura, a atualização fica esperando **no servidor**, em segundo plano, e entra sozinha quando liberar (ou de
madrugada, se ficar pendente mais de 24 h). Não é erro e não precisa rodar de novo.

Argumento recebido: `$ARGUMENTS`
- vazio: fazer o deploy;
- `status`: só ver como está o servidor (seção Status), sem mandar nada;
- `forcar`: deploy com `FORCAR=1` (troca o container na hora, derrubando as chamadas por segundos).

## Antes de mandar

1. **Endereço do servidor:** `deploy/servidor.conf` (fora do git) deve ter a linha `SERVIDOR=usuario@ip-da-vpn`. Se não
   existir, pergunte o endereço ao usuário e crie o arquivo. Não escreva o endereço em nenhum arquivo versionado.
2. **O que vai ser mandado:** rode `git status --short` e `git fetch origin main` e veja `git rev-list --left-right --count HEAD...origin/main`.
   - Arquivos modificados ou não commitados: **eles vão junto para o servidor.** Liste para o usuário e pergunte se é isso mesmo antes de seguir.
   - Fora da `main`, ou atrás de `origin/main`: avise (ex.: "você está na branch X / faltam N commits da main") e pergunte se segue assim ou se atualiza antes (`git checkout main && git pull`).
   - Tudo limpo e na `main` em dia: siga sem perguntar.
3. **Forçar:** use `FORCAR=1` **somente** se o argumento for `forcar` ou o usuário pediu com todas as letras neste pedido
   (ex.: "atualiza mesmo com gente em chamada"). Nunca por conta própria, nem para "resolver" uma espera.

## Mandar

Rode da raiz do repositório, com tempo limite longo (montar a imagem pode levar alguns minutos):

```bash
sh deploy/umbrel.sh
```

ou, só quando forçar estiver autorizado:

```bash
FORCAR=1 sh deploy/umbrel.sh
```

## Explicar o resultado (em português simples, sem jargão)

- "Só a interface mudou": entrou sem reiniciar nada; ninguém percebeu. As páginas abertas recarregam sozinhas quando não atrapalhar.
- "reiniciando só o app": o servidor reiniciou em ~2 s; quem estava em chamada continuou na chamada.
- "trocando o container": as chamadas, se havia, caíram por alguns segundos e voltaram sozinhas.
- "Agora: … Esta atualização …" / "esperando": diga **o que está segurando** (a linha "Agora:" diz: conversa acontecendo,
  bot de música ou assistir junto), que a atualização entra sozinha quando isso acabar (ou de madrugada depois de 24 h) e
  que dá para conferir depois com `/deploy status`. Ofereça forçar, explicando o efeito, mas não force sem a resposta.
- Erro de SSH (`Connection refused`, `timed out`, `Permission denied`): provavelmente a VPN está desligada neste PC ou a
  chave SSH não está carregada. Diga isso; não tente outro caminho.
- Erro no `docker build`: mostre as últimas linhas do erro e pare.

## Status

Com o endereço de `deploy/servidor.conf` (`. deploy/servidor.conf` e use `$SERVIDOR`), num único `ssh`:

```bash
ssh "$SERVIDOR" 'docker ps --filter name=resenha --format "{{.Status}}"; cat ~/resenha-data/em-chamada.json 2>/dev/null; echo; ls ~/.resenha-deploy/espera.pid 2>/dev/null && echo "HA ATUALIZACAO ESPERANDO"; tail -n 8 ~/.resenha-deploy/espera.log 2>/dev/null; docker logs --since 1h resenha 2>&1 | grep -E "\[voz\]|Voz:|Interface atualizada|ALERTA" | tail -n 8'
```

Resuma: o servidor está de pé? Quantas pessoas em chamada agora (`inCalls`), quantas conversando (`emAtivas`), salas com
bot/assistir junto (`sessoes`)? Há atualização esperando e desde quando? O que os últimos registros dizem (reinícios do app,
interface atualizada, alertas)?
