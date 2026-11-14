# Fóruns

## Estado atual (etapa 1 feita, escopo menor)
Implementado em `server/forum.js`, `public/forum.js` e `public/forum.css` (teste: `scripts/forum-test.mjs`):
- canal de fórum (`type 15`) com posts no estilo Reddit: ▲ e votos à esquerda, tags coloridas, título, começo do texto,
  imagem, nº de comentários; ordem **Em alta / Novos / Top / Atividade**, filtro por tag, busca e o quadro "Sobre" ao lado;
- criar/editar post (título, tags, texto com prévia, imagens e vídeos), apagar, fixar e trancar (moderação);
- post aberto: o post no topo e os comentários no chat comum (o post é um canal `type 11`, como na proposta);
- tags e regras do fórum editáveis (quem gerencia canais); fórum novo já vem com 4 tags.

Diferenças em relação à proposta abaixo: o **texto do post fica em `forum_posts.content`** (não como primeira mensagem do
canal), e **comentários e última atividade são contados na consulta** (sem contador para manter). Ainda **não** feito:
seguir posts e não lidas de post, arquivamento automático, "melhor resposta", seção Fóruns (feed geral), aba Posts no
perfil, atalhos de clipe/mensagem → post e fóruns abertos. Comentário em post só avisa quem foi mencionado.

---

# Proposta original

Dois pedaços, nessa ordem:
1. **Canal de fórum** dentro do servidor: no lugar do chat, uma lista de **posts** (título, corpo, tags), cada um com a
   própria conversa.
2. **Seção Fóruns**: feed e busca dos posts de todos os fóruns que a pessoa enxerga, com "Em alta / Novos / Top", no
   estilo Reddit, mas no tamanho da Resenha (uma instalação, um grupo de amigos).

O que **não** entra: comentários em árvore (a resposta citando a mensagem, que já existe, resolve), karma ou ranking de
pessoas e fórum fora da VPN.

---

## 1. Canal de fórum

### A ideia central: cada post é um canal escondido
Um post é uma linha em `channels` com `type = 11` e `parent_id` apontando para o fórum (`type = 15`). As mensagens do
post são mensagens comuns desse canal. Com isso, sem código novo, o post já tem:

- mensagens, respostas, edição, anexos, reações, enquetes, mensagens de voz, tradução e spoiler;
- não lidas e "lido" sincronizado entre aparelhos (`read_states` usa o id do canal), menções e notificações;
- busca (`em:` aceita o post), aba Arquivos, "Apagar minhas mensagens", armazenamento e reputação/soft-mute;
- permissão: `canAccessChannel` já libera pelo `guild_id` (ser membro do servidor).

A primeira mensagem do canal do post é o **corpo** do post (`messages.type = 20`, para o app desenhar diferente e não
deixar apagar sem apagar o post). O resto da conversa são as **respostas**.

O que precisa mudar por causa disso:
- `guildObj` (`server/index.js`, `SELECT * FROM channels WHERE guild_id=?`) **não manda** os `type = 11` no READY
  (seriam centenas). Os posts vêm sob demanda pela API abaixo.
- `guildChOrder`, a lista de canais, reordenar e favoritos ignoram o `type = 11`. Um post pode virar favorito à parte
  (com o fórum de origem), o que fica para depois.
- As não lidas do READY (`chIds`, só `type 0/2`) não incluem os posts. O fórum mostra a bolinha quando algum post
  **seguido** tem novidade (ver *Seguir*).
- Apagar o fórum apaga os posts (`ON DELETE CASCADE` não pega `parent_id`: apagar à mão `WHERE parent_id=?`).

### Tabelas novas
```sql
-- dados que a lista de posts precisa sem abrir o canal de cada um
CREATE TABLE forum_posts(
  id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,  -- = id do canal type 11
  forum_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,                 -- até 120 caracteres
  tags TEXT NOT NULL DEFAULT '[]',     -- ids das tags do fórum (até 5)
  cover TEXT,                          -- primeira imagem do corpo (miniatura), para o modo grade
  preview TEXT DEFAULT '',             -- começo do corpo, sem markdown (200 caracteres)
  created_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,            -- última resposta (ordem "Atividade recente")
  replies INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,    -- soma dos votos (ver seção 2)
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,   -- só moderadores respondem
  solved_mid TEXT,                     -- mensagem marcada como "melhor resposta"
  archived_at INTEGER                  -- sem resposta há X dias: some da lista padrão, volta ao responder
);
CREATE INDEX forum_posts_forum ON forum_posts(forum_id, pinned DESC, last_at DESC);
CREATE INDEX forum_posts_guild ON forum_posts(guild_id, created_at DESC);

CREATE TABLE forum_follows(post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER, PRIMARY KEY(post_id, user_id));
```

Configuração do fórum numa coluna nova `channels.forum` (JSON, só no `type = 15`):
```json
{
  "tags": [{ "id": "t1", "name": "Dúvida", "emoji": "❓", "color": "#5865f2", "modOnly": false }],
  "requireTag": false,
  "guidelines": "Texto em markdown que aparece no topo e na tela de criar post",
  "sort": "activity",          // padrão: activity | new | hot | top
  "layout": "list",            // list | grid
  "whoPosts": "everyone",      // everyone | mods
  "archiveDays": 30,           // 0 = nunca
  "votes": true
}
```

### API
```
GET    /api/forums/:fid/posts?sort=&tag=&q=&before=&archived=1  -> { posts: [postObj], next }   (25 por página)
POST   /api/forums/:fid/posts      { title, content, tags, attachments }  -> postObj  (cria canal + forum_posts + corpo)
GET    /api/posts/:pid             -> postObj (+ corpo)
PATCH  /api/posts/:pid             { title?, tags?, pinned?, locked?, solved_mid? }
DELETE /api/posts/:pid             (autor ou MANAGE_MESSAGES; apaga o canal)
PUT    /api/posts/:pid/follow  /  DELETE /api/posts/:pid/follow
PATCH  /api/channels/:fid          { forum: {...} }   (rota que já existe; MANAGE_CHANNELS)
```
As respostas usam as rotas de sempre: `GET/POST /api/channels/:pid/messages`.

`postObj = { id, forum_id, guild_id, author, title, tags, cover, preview, created_at, last_at, replies, score, myVote,
pinned, locked, solved_mid, followed, unread }`

Permissões (bits de `P`, sem bit novo):
- criar post: membro (ou só quem tem `MANAGE_MESSAGES`/`MODERATE` se `whoPosts = "mods"`); castigo e soft-mute valem;
- editar título e tags: o autor ou `MANAGE_MESSAGES`;
- fixar, trancar, arquivar e tags `modOnly`: `MANAGE_MESSAGES`;
- marcar resolvido: o autor ou `MANAGE_MESSAGES`.

### Eventos (WebSocket, para quem é do servidor)
`FORUM_POST_CREATE`, `FORUM_POST_UPDATE` (título, tags, contadores, voto, fixado…) e `FORUM_POST_DELETE`. Uma resposta
nova manda `MESSAGE_CREATE` só para quem está **com o post aberto ou o segue**, e `FORUM_POST_UPDATE` (`last_at`,
`replies`) para o resto, juntado a cada 2 s por fórum para não lotar o servidor inteiro.

### Seguir
- O autor segue o próprio post. Quem responde passa a seguir (desliga em Notificações).
- Posts seguidos geram não lida e notificação conforme o sino do fórum (Todas / Só @menções / Nada).
- Fórum sem post seguido com novidade não acende. Post novo acende o fórum de leve (sem número), como canal sem menção.

### Telas (`public/forum.js`)
- **Fórum:** diretrizes recolhíveis, botão **Novo post**, chips das tags, busca no título, ordem e alternar lista/grade.
  Cada linha mostra título, tags, autor, prévia, capa, respostas, ▲ e "há 2 h". Fixados em cima, arquivados num
  "Ver arquivados" no pé.
- **Novo post:** título, tags, corpo com o compositor normal (anexos, enquete, emoji) e prévia.
- **Post aberto:** no lugar do chat (ou em painel ao lado no computador). Mostra o corpo em destaque, as ações (Seguir,
  ▲, Resolvido, menu de moderação) e as respostas em chat comum. A "melhor resposta" aparece repetida logo abaixo do corpo.
- **Celular:** a lista ocupa a tela, abrir um post empilha e o voltar retorna (`backclose.js`).

### Integrações
- **Clipe → post:** na galeria, "Postar no fórum", com o clipe como anexo e o nome como título.
- **Mensagem → post:** clique direito → "Criar post a partir daqui", com a mensagem citada e um link para a original.
- **Descobrir → post:** numa notícia ou promoção, "Discutir no fórum", com o link e a imagem.
- **Armazenamento:** anexos de posts **não expiram** pela limpeza automática do servidor (como as fixadas). Aparecem
  separados por fórum em Configurações do servidor → Armazenamento.
- **Auditoria:** criar, apagar, trancar e fixar posts entram no registro.

---

## 2. Seção Fóruns (feed e busca)

Uma entrada **Fóruns** na seção **Jogos** da barra (junto de Descobrir e Procurar jogadores).

- **Feed:** posts de todos os fóruns de servidores em que a pessoa está. Abas **Em alta / Novos / Top** (dia, semana,
  mês, tudo) e **Seguindo**. Filtros por servidor, fórum e tag.
- **Busca:** título e corpo (`forum_posts.title` + o corpo em `messages`), com os filtros `de:`, `em:` e `tag:`.
- **Votos:** só ▲ (sem ▼, para um grupo pequeno não virar briga). Cada fórum pode desligar. Mostra o número, não quem
  votou.
- **"Em alta"** usa a nota `(score + replies/2 + 1) / (horas + 2)^1.5`, calculada na consulta e limitada aos posts dos
  últimos 14 dias.
- **Perfil:** aba "Posts" com o que a pessoa publicou em fóruns que **quem olha** também enxerga.

```sql
CREATE TABLE forum_votes(post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER, PRIMARY KEY(post_id, user_id));
```
```
GET  /api/feed?sort=hot|new|top&range=&guild=&tag=&q=&before=   -> { posts: [postObj + guild/fórum resumidos], next }
PUT  /api/posts/:pid/vote   /   DELETE /api/posts/:pid/vote     (atualiza forum_posts.score na mesma transação)
GET  /api/users/:id/posts
```
Bloqueios: posts e respostas de quem a pessoa bloqueou ficam escondidos no feed, como no chat.

### Depois: fóruns abertos na instalação
O dono marca um fórum como **aberto**. Assim qualquer conta da instalação lê sem entrar no servidor e, se permitido,
posta. Aparece em "Explorar fóruns" dentro da seção. É a parte que mexe em permissão de verdade:
- `canAccessChannel` passa a liberar leitura de `type 11/15` abertos para quem não é membro, mas só nas rotas de
  fórum (o resto do servidor continua fechado);
- banidos do servidor não leem nem postam. Castigo, soft-mute e reputação precisam valer para quem não é membro (hoje
  pressupõem `members`);
- a lista de membros, a presença e a voz do servidor continuam invisíveis para quem só lê o fórum.

---

## Ordem de implementação
1. Tipo 15/11, `forum_posts`, API de posts, tela do fórum e do post, tags, fixar, trancar e resolvido.
2. Seguir, não lidas e notificações de posts; arquivamento automático; anexos sem expirar.
3. Seção Fóruns: feed, ▲, busca e aba Posts no perfil.
4. Atalhos de clipe, mensagem e Descobrir para post.
5. Fóruns abertos na instalação.

## Em aberto
- O **LFG** vira um tipo de fórum (anúncio = post com campos)? Por enquanto fica separado.
- Posts **em DMs/grupos**? Não, só em servidor.
- Limite de posts por pessoa por hora (sugestão: 5, com donos e moderadores fora do limite).
