# Clipes: engajamento, ranking semanal e recomendações

Evolução do sistema de clipes que já existia (galeria, player, "Clipes da semana" no painel *Ativo agora*). Nada foi
reescrito do zero: as tabelas `clips`, `clip_views`, `clip_favs` e `clip_shares`, o player de `public/clipsgallery.js`
e o painel de `public/activity.js` continuam os mesmos, com o que faltava acrescentado.

## Checklist

- [x] Auditoria do que existia (tabelas, rotas, player, painel, testes) e testes de clipes rodando antes de mexer
- [x] Visualização qualificada (não conta abrir e fechar nem clique acidental)
- [x] Curtidas (uma por pessoa; o autor não curte o próprio clipe)
- [x] Compartilhamentos contados por pessoa (reaproveita `clip_shares`)
- [x] Retenção: % concluído (sem contar trecho repetido) e tempo assistido (limitado a uma volta do clipe)
- [x] Proteções: sessão criada pelo servidor, limite pelo relógio, valores que nunca voltam, rajadas ignoradas,
      tempo mínimo de relógio para qualificar, teto de sessões por clipe/pessoa, autor fora das métricas, limite de curtir/descurtir
- [x] Ranking ponderado 35/25/25/15 com taxas suavizadas e normalização 0–1
- [x] Top 3 com expansão para Top 5
- [x] Categorias: Mais popular, Favorito da galera, Surpresa da semana, Descoberta
- [x] Mínimo de dados para entrar e aviso de "semana devagar"
- [x] Recomendações leves e explicáveis (jogo, criador, curtidas/compartilhamentos, amigos, qualidade, "você aparece")
- [x] Interface: Top 3/5, métricas à vista, Destaques especiais, Recomendados pra você, curtir no player e na galeria
- [x] Testes unitários (`scripts/clipstats-unit-test.mjs`) e de ponta a ponta com servidor e vídeo reais (`scripts/clipstats-test.mjs`)
- [x] Cenários com poucas pessoas e poucos clipes
- [x] Regressão: testes antigos de clipes e do painel ajustados à nova regra de visualização e passando
- [x] Métricas em tempo real (evento `CLIP_STATS`) na galeria, no player aberto e no painel

## Onde está

| Arquivo | O quê |
|---|---|
| `server/clipstats.js` | regras puras (`applyBeat`, `weeklyRanking`, `recommend`) e o serviço com o banco |
| `server/index.js` | rotas `/view`, `/watch`, `/like`; `clipObj` com `stats` e `liked`; `clipsWeekFor` (painel) |
| `server/activity.js` | `weekFor` pede os clipes ao `clipsWeek`; expõe `clipGame` e `gameKeys` |
| `public/clipwatch.js` | mede o que foi assistido no player e manda as batidas |
| `public/clipsgallery.js` | player e galeria: curtir e métricas |
| `public/activity.js` | painel: Top 3/5, Destaques especiais, Recomendados pra você |

## Métricas

Todas ignoram o autor do clipe.

- **Visualização qualificada**: a pessoa cobriu pelo menos `min(6 s, 40% do clipe)` (mínimo 2 s) e passou no relógio
  pelo menos metade disso. Uma por pessoa, para sempre (`clip_views.qualified_at`). Abrir o player só marca "visto".
- **Curtida**: `clip_likes`, uma por pessoa.
- **Compartilhamento**: pessoas diferentes que mandaram o link do clipe numa conversa ou canal (`clip_shares` + autor da mensagem).
- **Retenção**: melhor sessão de cada pessoa — `clip_views.completion` (0–1) e `clip_views.watch_ms` (até a duração).

### Como o player mede

`public/clipwatch.js` só soma tempo com o vídeo tocando, a aba visível e avançando normalmente (saltos de mais de 1,5 s,
voltas e seeks não contam). O clipe é dividido em pedaços de 0,5 s e cada um conta uma vez: loop não aumenta a cobertura.
Batida a cada 5 s, ao esconder a aba e ao fechar/trocar de clipe (`keepalive`).

### Proteções no servidor (`applyBeat` e `beat`)

| Tentativa | O que acontece |
|---|---|
| abrir e fechar | sessão criada, nada qualifica |
| mandar "assisti tudo" logo depois de abrir | cortado em 2× o relógio desde o início e desde a última batida; não qualifica antes do tempo mínimo de relógio |
| sessão inventada ou de outra pessoa | recusada |
| loop infinito | cobertura e tempo limitados à duração; vale a melhor sessão, não a soma |
| valores menores numa batida nova | ignorados (nunca diminui) |
| rajada de batidas | ignorada (mínimo 0,9 s entre elas) |
| abrir o mesmo clipe sem parar | 20 sessões por pessoa e clipe por dia, 300 por pessoa por hora; depois o vídeo toca e não conta |
| autor assistindo/curtindo/compartilhando o próprio | não conta / recusado |
| curtir e descurtir sem parar | 30 trocas por minuto |
| mandar o link em vários canais | conta uma pessoa |

Limitação conhecida: contas falsas criadas de propósito continuam contando como pessoas. A suavização e o peso pequeno
das visualizações (15%, em escala log) diminuem o efeito.

## Ranking semanal

Clipes dos últimos 7 dias que o leitor pode ver.

```
nota = 0,35·retenção + 0,25·curtidas/visualização + 0,25·compartilhamentos/visualização + 0,15·visualizações
```

- Taxas suavizadas (média bayesiana com 5 visualizações "fantasmas" na média da semana): 3 views e 3 curtidas não
  vira 100% de aprovação contra 30 views e 24 curtidas.
- Cada componente é dividido pelo maior da semana (fica entre 0 e 1). Visualizações em escala log.
- Resultado: um clipe de quem tem pouca audiência, mas que prende quem assiste, disputa de igual com o do mais popular.
- Mínimo para entrar: 3 visualizações qualificadas (2 em servidores tão pequenos que 3 é impossível; nunca menos de 2).
- Menos de 3 clipes elegíveis: a interface avisa "semana devagar" em vez de inventar destaque.

### Categorias (um clipe cada; sem dado suficiente, não aparece)

| Categoria | Regra |
|---|---|
| Mais popular | mais visualizações qualificadas |
| Favorito da galera | mais curtidas (mínimo 2) |
| Surpresa da semana | visualizações nas últimas 48 h ≥ 1,5× a mediana dos outros clipes recentes do criador |
| Descoberta | fora do Top 3, poucas visualizações (até a mediana) e engajamento acima da média |

Se o clipe da categoria já está à vista no ranking, o selo aparece no cartão; senão, ele aparece em "Destaques especiais".

## Recomendações

Sem aprendizado de máquina: uma soma de sinais, cada um com o seu motivo.

| Sinal | Peso | Motivo mostrado |
|---|---|---|
| você aparece no clipe | 0,35 | "Você aparece neste clipe" |
| jogo que você assiste (clipes vistos, curtidos ×2, compartilhados ×3) ou jogou na semana | 0,30 | "Porque você curte VALORANT" |
| criador com quem você mais interage | 0,25 | "De quem você mais assiste" |
| amigos que curtiram (×2), compartilharam (×3) ou assistiram | 0,25 | "3 amigos curtiram" |
| qualidade do clipe na semana | 0,20 | "Em alta na galera" |
| clipe de amigo (para quem ainda não tem histórico) | 0,08 | "Clipe novo de um amigo" |

Multiplicado por um fator de novidade (`0,5 + 0,5·½^(idade/7 dias)`). Candidatos: últimos 30 dias, que você não
assistiu de verdade, que não são seus e que não estão no ranking nem nas categorias. Até 4.

## Tempo real

Quando muda o que todo mundo vê — visualização qualificada nova, retenção de quem já contava, curtida/descurtida,
compartilhamento novo ou mensagem com o link apagada — o servidor manda `CLIP_STATS { id, guild_id, stats }` para quem
pode ver o clipe (`clipShareAudience`). Os avisos são agrupados por clipe: no máximo um a cada `CLIP_STATS_MS`
(padrão 1 s), então 10 pessoas assistindo juntas não viram uma enxurrada. Abrir o player sem assistir não gera aviso.

No app, a galeria troca só a linha de números do cartão (a grade e as prévias não são redesenhadas), o player aberto
atualiza sem reiniciar o vídeo e o painel *Ativo agora* atualiza os números onde o clipe aparecer. A **ordem** do ranking
não muda na hora (evita cartões pulando); ela é recalculada quando o painel recarrega.

## Mudança de comportamento

Antes, abrir o player contava visualização. Agora só a visualização qualificada conta. As aberturas antigas continuam
marcando "visto", mas não entram nas métricas (o ranking é semanal, então isso se acerta sozinho em 7 dias).
