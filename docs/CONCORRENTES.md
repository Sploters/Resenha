# Concorrentes do Discord: o que copiar e o que evitar

Anotações dos concorrentes, para trazer o melhor de cada um para a Resenha. Cada entrada separa o que a Resenha **já tem**, o que **vale trazer** e o **erro a evitar**. A lista consolidada fica no fim.

---

## 1. Fluxer
Chat e voz no estilo Discord, open-source (AGPLv3), da Suécia, em beta público. ~100 mil usuários, nota 3,3.

**Pontos fortes**
- Interface familiar de canais, como no Discord.
- Open-source e auto-hospedável.
- Moderação granular, **CSS personalizado** e salvar mídia.
- **Entrar na voz de mais de um aparelho** ao mesmo tempo.
- Bots e API parecidos com os do Discord.
- Paridade com o Discord: texto, voz, vídeo, cargos, permissões, emojis, tela e DMs.
- Privacidade: GDPR, sem anúncios, sem treinar IA com o conteúdo, código auditável.

**Pontos fracos**
- Comunidade pequena e documentação fraca (ainda em beta).
- Sem app nativo de celular completo.
- Bloqueado num estado inteiro (Mississippi): depende de regras locais.
- E2EE ainda "em desenvolvimento".
- **IA analisa toda mídia enviada** atrás de NSFW, e o usuário só tem a "promessa" de que nada vai para terceiros.
- Risco de app indie: pode fechar ou mudar de rumo sem aviso.

**Comparando com a Resenha**
| Item | Fluxer | Resenha |
|---|---|---|
| Auto-hospedado | Sim | Sim (Umbrel/Docker) |
| Texto, voz, vídeo, tela, cargos, permissões, emojis, DMs | Sim | Sim |
| E2EE | Em desenvolvimento | **Já tem** nas DMs 1:1 (texto, arquivos e chamadas) |
| Salvar mídia | Sim | **Já tem**: Mídia favorita e aba Arquivos |
| Moderação granular | Sim | Parcial: cargos, permissões por canal, Reputação e auditoria; falta automod |
| CSS personalizado | Sim | Não (só 4 temas, cor, fonte e espaçamento) |
| Voz em vários aparelhos ao mesmo tempo | Sim | A conferir |
| Bots e API pública | Sim | Não (só o bot de música embutido) |
| App de celular | Incompleto | Navegador / app instalado (PWA) |
| Varredura de mídia por IA | Sim (polêmico) | Não |

**Vale trazer**
1. **API de bots com token**, compatível com o formato dos bots do Discord onde der. É a maior lacuna: o README lista "sem bots" nas limitações.
2. **CSS personalizado** (Aparência → CSS próprio), com temas da comunidade para importar e um "modo seguro" para desligar um CSS quebrado.
3. **Voz em vários aparelhos**: por exemplo, entrar pelo celular para falar e pelo PC para transmitir, sem derrubar a outra conexão.
4. **Moderação granular**: automod (palavras, links, spam, menções em massa), castigo com tempo e regras por canal.

**Erros a evitar**
- **Não fazer varredura de mídia por IA no servidor.** Se um dia existir filtro de NSFW, que seja opcional, por servidor e rodando local.
- Documentação: manter o README e os `docs/` em dia, que é onde o Fluxer peca.
- Não deixar o celular para depois.

---

<!-- Próximos concorrentes entram aqui, no mesmo formato. -->

## Lista consolidada (prioridades)
| # | Ideia | Origem | Status na Resenha |
|---|---|---|---|
| 1 | API de bots + tokens | Fluxer | Não tem |
| 2 | CSS personalizado / temas da comunidade | Fluxer | Não tem |
| 3 | Voz em vários aparelhos ao mesmo tempo | Fluxer | A conferir |
| 4 | Automod / moderação granular | Fluxer | Parcial |
| ✗ | Varredura de mídia por IA no servidor | Fluxer (evitar) | Não fazer |
