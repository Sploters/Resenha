# Documentação da Resenha

Comece pelo [README](../README.md) da raiz. Aqui está o resto, por assunto.

- [PROXIMOS-PASSOS.md](PROXIMOS-PASSOS.md): **comece por aqui.** O que já foi feito (com números), como medir, lições e o roadmap em ordem.
- [AUDITORIA-RECURSOS.md](AUDITORIA-RECURSOS.md): pedido da auditoria de consumo de recursos e métricas de referência (antes das otimizações).

## Instalação e uso
- [INSTALACAO.md](INSTALACAO.md): requisitos, Node, Docker, `deploy/umbrel.sh`, atualizar sem derrubar a chamada, VPN, app desktop, dados e cópia de segurança.
- [CONFIGURACAO.md](CONFIGURACAO.md): variáveis de ambiente (voz, limites, tradução, Steam, música, GIFs, alertas).
- [RECURSOS.md](RECURSOS.md): lista completa do que o app faz, Watch Together, bot de música e limitações conhecidas.
- [ADMINISTRACAO.md](ADMINISTRACAO.md): saúde do servidor, alertas, desempenho e estatísticas de uso.
- [ATUALIZACOES-E-RELATORIOS.md](ATUALIZACOES-E-RELATORIOS.md): atualização do app desktop, versão mínima nas calls e relatório de problema.
- [../PRIVACIDADE.md](../PRIVACIDADE.md): o que o servidor guarda, quem vê e o que sai dele.
- [../SECURITY.md](../SECURITY.md): como relatar uma falha de segurança.

## Recursos em detalhe
- [WATCH-TOGETHER.md](WATCH-TOGETHER.md): assistir juntos (YouTube, link de vídeo e sincronização assistida da Netflix, Prime Video e Crunchyroll).
- [INTENCOES.md](INTENCOES.md): "A fim de jogar" (LFG invertido).
- [FORUM.md](FORUM.md): canais de fórum.
- [DESCOBRIR.md](DESCOBRIR.md): aba Descobrir e as fontes dela.
- [CLIPES-ENGAJAMENTO.md](CLIPES-ENGAJAMENTO.md): engajamento, ranking semanal e recomendações de clipes.
- [FASE3-REMOTE.md](FASE3-REMOTE.md): controle remoto (mouse, teclado, controle de videogame).

## Desenvolvimento
- [DESENVOLVIMENTO.md](DESENVOLVIMENTO.md): scripts, arquivos gerados, testes, verificação automática do GitHub, release do app desktop, teste de carga.
- [PROMPTS.md](PROMPTS.md): como escrever pedidos longos para o Claude (prioridades, alvo com números, portões de verificação), com modelo em branco, dois prompts prontos e o roteiro de capturas do crítico visual (`scripts/critico-capturas.mjs`).
- [CHECKLIST-CONCORRENTES.md](CHECKLIST-CONCORRENTES.md): ideias aprovadas dos concorrentes, em ordem de trabalho.
- [PROXIMAS-CORRECOES.md](PROXIMAS-CORRECOES.md): problemas à espera de dados para corrigir.

## Mídia, voz e transmissão
- [TRANSMISSAO-120FPS.md](TRANSMISSAO-120FPS.md): transmissão a 60/120 FPS pela placa de vídeo (app desktop, Windows).
- [CAPTURA-WGC-DXGI.md](CAPTURA-WGC-DXGI.md): captura WGC + DXGI no `lc-stream` (pesquisa, prova de conceito e resultados).
- [TESTE-CAPTURA-AMIGOS.md](TESTE-CAPTURA-AMIGOS.md): roteiro de testes da captura com os amigos e resultados recebidos.
- [PORTA-POR-VOZ.md](PORTA-POR-VOZ.md): proteção por voz (porta guiada por VAD), "Só a minha voz" e áudio "só desta tela".
- [VOZ-FORA-DA-VPN.md](VOZ-FORA-DA-VPN.md) e [TURN.md](TURN.md): voz para quem está fora da VPN (IPv6 público e túnel pela conexão do site) e o TURN próprio, se um dia valer a pena.
- [BANDA-E-LATENCIA.md](BANDA-E-LATENCIA.md): banda da voz e como baixar o ping de quem está longe.
- [DESKTOP-VISUAL.md](DESKTOP-VISUAL.md): app desktop com tela cheia com defeito, texto borrado, vídeo piscando.

## Desempenho
- [MODO-LEVE.md](MODO-LEVE.md): modo leve (manual e automático com o jogo aberto) e "Consumo agora".
- [ADMINISTRACAO.md](ADMINISTRACAO.md#desempenho): entrega da interface e alerta de lentidão.
- [DESENVOLVIMENTO.md](DESENVOLVIMENTO.md#desempenho-e-carga): medição, orçamento e teste de carga.
- [PROXIMOS-PASSOS.md](PROXIMOS-PASSOS.md#como-medir-ferramentas-em-scripts): medir CPU, memória e transmissão antes e depois (`scripts/perf-*.mjs`, `medir-resenha.ps1` no Windows).

## Histórico
Planos já executados, auditorias pontuais e relatórios de fase. Ficam como registro do que foi medido e decidido; podem
estar desatualizados.
- [historico/FASE0-AUDITORIA.md](historico/FASE0-AUDITORIA.md): auditoria e planejamento técnico inicial (2026-11-02).
- [historico/PASSO0-DIAGNOSTICO-FPS.md](historico/PASSO0-DIAGNOSTICO-FPS.md): diagnóstico dos ~48 FPS na transmissão de tela e Spikes A/B.
- [historico/FASE1-ATIVIDADES.md](historico/FASE1-ATIVIDADES.md): Fase 1, atividade social com a Steam.
- [historico/FASE2-WATCH.md](historico/FASE2-WATCH.md): Fase 2, várias transmissões na sala (layouts, simulcast).
- [historico/FASE2-CAPTURA.md](historico/FASE2-CAPTURA.md): Fase 2, captura e transmissão (M1-M13) e kit de testes para Windows.
- [historico/CAPTURA-WINDOWS10.md](historico/CAPTURA-WINDOWS10.md): plano para a transmissão no Windows 10.
- [historico/AUDITORIA-DESEMPENHO.md](historico/AUDITORIA-DESEMPENHO.md): auditorias de desempenho (2026-11-04 e 2026-11-11).
- [historico/PLANO-DESEMPENHO.md](historico/PLANO-DESEMPENHO.md): checklist de desempenho, concluído, com os resultados medidos.
- [historico/CONCORRENTES.md](historico/CONCORRENTES.md): análise dos concorrentes do Discord e as decisões (16/11/2026).
