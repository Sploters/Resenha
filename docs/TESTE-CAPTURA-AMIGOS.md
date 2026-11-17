# Roteiro de testes: captura WGC + DXGI (com os amigos)

Objetivo: ver, em PCs e jogos reais, se a escolha automática entre WGC e DXGI funciona, quanto custa e onde falha.
Detalhes técnicos e limitações: `docs/CAPTURA-WGC-DXGI.md` (Fase 2).

## Antes de começar
1. **Servidor**: publicar esta branch no servidor da Resenha (a página nova traz a opção "Método de captura" e o painel).
   Sem isso o app novo funciona igual ao de antes (caminho clássico).
2. **App**: cada pessoa roda o `Resenha-Teste-Captura-1.0.40.exe` (portátil: não instala nada; para voltar, é só fechar
   e abrir a Resenha instalada de sempre). Feche a Resenha instalada antes (o app abre uma vez só).
   O Windows pode avisar "app não reconhecido" (o .exe não tem assinatura de código): "Mais informações > Executar assim mesmo".
3. Configurações > Transmissão: FPS **60 ou 120** (abaixo de 60 a transmissão é sempre pelo Chromium).
   Experimental > Método de captura (teste) = **Automático**.
4. Uma pessoa transmite, pelo menos uma assiste. Durante a live: botão de ajustes da transmissão > "Diagnóstico da
   captura". No fim de cada teste: **"Copiar relatório do teste"** e colar no chat (ou num arquivo) com o nome do teste.

Se algo der muito errado durante a live: no mesmo painel, Método de captura = **Clássico (versão anterior)** ou
**Forçar Chromium**. Troca na hora, sem sair da sala.

## Jeito mais fácil (para quem não entende de computador): `Teste-Transmissao-Resenha.exe` (~4 MB)
Dois cliques, ~30 s sem mexer em nada, e o arquivo `Resenha-teste-<PC>.json` aparece na Área de Trabalho (a pasta abre
sozinha e um aviso diz o que mandar). Não precisa de jogo, sala, servidor nem de alguém assistindo.
É o lc-stream da PoC (fora do instalador) com esse nome: `sh native/autoteste/montar.sh <pasta>`.
Abre o Jogo de Teste (abaixo) em tela cheia exclusiva e sem bordas e mede WGC da janela, WGC do monitor e DXGI com o
jogo na frente, **minimizado** (Alt+Tab simulado, o caso do "Could not start video source") e depois de voltar: abriu
ou o erro, quadros/s, imagem preta. Não usa o Chromium (o .exe com Electron tinha 110 MB e não dava para baixar):
o comportamento do Chromium com janela minimizada foi conferido à parte (recusa com "Could not start video source").
Não testa a transmissão de ponta a ponta; isso continua no kit e no roteiro abaixo.

## Jeito rápido (sem jogo): kit `teste-captura-resenha.zip`
O kit (`native/pacote-captura`, montado por `montar.sh`) traz o **Jogo de Teste (Resenha)**: `lc-stream-poc.exe
--poc-captura --jogo-teste --modo tela-cheia|sem-bordas`. Janela do tamanho do monitor com Direct3D próprio e animação
calma (sem piscar). Em `tela-cheia` usa tela cheia exclusiva e, como os jogos, sai dela e **minimiza no Alt+Tab** e volta
ao receber o foco: reproduz o caso do Valorant sem precisar de jogo nem de anti-cheat. O `TESTAR` roda 4 casos (tela
cheia/sem bordas × janela/tela inteira), lê o "Copiar relatório do teste" da área de transferência e grava tudo em
`resultado-transmissao-<PC>.json`. Os testes com jogo de verdade abaixo continuam valendo para quem quiser.

## O que anotar em cada teste
| Campo | Onde ver |
|---|---|
| Windows 10 ou 11 (build), placa de vídeo, Hz do monitor | painel ("Por que começou assim" traz o build) / Configurações do Windows |
| Método em uso e trocas (com motivo e "ms sem quadro novo") | painel > Histórico |
| FPS capturado / codificado | painel |
| FPS que quem assiste vê | quem assiste: clique direito na transmissão > estatísticas |
| CPU do programa nativo | painel ("Programa nativo") |
| GPU | Gerenciador de Tarefas > Desempenho > GPU (anotar com e sem a live) e coluna GPU de "lc-stream.exe" em Detalhes |
| Qualidade visual | quem assiste: nitidez, travadas, tela preta, borda amarela, janelas por cima aparecendo |
| Estabilidade | a live caiu? a voz cortou? quantas vezes trocou de método? |

## Testes
| # | Teste | Como | Esperado (a confirmar) |
|---|---|---|---|
| 1 | Área de trabalho, 60 FPS | Transmitir a tela inteira, mexer em janelas | Win11: WGC. Win10: DXGI. Nenhuma troca. |
| 2 | Mesmo, 120 FPS | idem com 120 FPS (monitor de 120 Hz+ se tiver) | FPS capturado até o Hz do monitor |
| 3 | Valorant sem bordas | Valorant em "Janela sem bordas", transmitir a tela | imagem do jogo, sem troca |
| 4 | Valorant tela cheia | Valorant em "Tela cheia", transmitir a tela | Win10: DXGI segue; se o WGC estiver em uso e congelar, troca para DXGI. Win11: WGC deve seguir |
| 4b | Jogo em tela cheia escolhido minimizado | Valorant em "Tela cheia", Alt+Tab para a Resenha, escolher a JANELA do Valorant (aparece "minimizado") e Transmitir | aviso "O jogo está minimizado..." (sem o erro "Could not start video source"); ao voltar para o jogo a live começa em 1-2 s |
| 5 | Valorant como janela | transmitir a janela do Valorant (sem bordas e tela cheia) | Win11: WGC isola a janela. Win10: DXGI recorta (o que estiver por cima aparece) |
| 6 | Outros jogos DirectX | 2-3 jogos (DX11 e DX12), sem bordas e tela cheia | igual ao 3/4 |
| 7 | Resoluções | jogo em 1280x720, 1600x900 e na nativa | imagem certa (barras pretas se a proporção mudar) |
| 8 | Janelas sobrepostas | transmitir uma janela e pôr outra por cima | WGC: não aparece. **DXGI: aparece** (limitação) |
| 9 | Mudar resolução ao vivo | mudar a resolução do Windows ou do jogo durante a live | DXGI "recriado" no painel; live continua |
| 10 | Entrar/sair da tela cheia | Alt+Enter / Alt+Tab no jogo durante a live | trocas (se houver) com motivo; live continua |
| 11 | Ctrl+Alt+Del / UAC | abrir e fechar durante a live | ~1-2 s sem imagem e volta sozinho |
| 12 | Forçados | repetir 1 e 4 com Forçar WGC e Forçar DXGI | sem troca; diferenças de FPS/CPU |
| 13 | Voz | falar durante todos os testes | voz não pode cortar nem atrasar |
| 14 | Duração | live de 30 min jogando | sem queda, trocas raras |

## Resultados
Preencher por PC (copiar a tabela):

| # | PC (Win/placa/Hz) | Método final | Trocas (motivo, ms) | FPS cap/cod/visto | CPU % | GPU % | Visual | Problemas |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |

## Se der problema
- "Não foi possível compartilhar a tela: Could not start video source": o Chromium não começa a captura de uma janela
  minimizada (jogo em tela cheia depois do Alt+Tab). Com o servidor atualizado a Resenha espera o jogo voltar; se ainda
  aparecer, anotar Windows, jogo, modo de vídeo e se foi "janela" ou "tela inteira".
- A live caiu para "Modo normal (Chromium)": o motivo está no painel ("Por que não o nativo" e no histórico). Copiar o relatório.
- Tela preta para quem assiste: anotar o método em uso e se o Windows estava em tela cheia; testar Forçar o outro método.
- Voltar ao app de antes: fechar o portátil e abrir a Resenha instalada. Nada do teste fica no PC além das
  configurações da conta (a opção "Método de captura"; deixe em Automático ou Clássico).

## Resultados recebidos

### 2026-11-16 · Windows 11 25H2 (26200) · RTX 3080 · 1920x1080 a 144 Hz
**Kit antigo, parte 2 (Valorant de verdade, sem transmitir):** em "Tela cheia" o Windows diz **tela cheia exclusiva**
(estado 3) em 25 de 26 s com o jogo na frente. Em "Janela sem bordas" diz "ocupado" (2) e em "Janela", normal (5).
Ou seja, a "Tela cheia" do Valorant é exclusiva de verdade e minimiza no Alt+Tab, como o Jogo de Teste. A parte 3
(transmissões) não foi feita.

**Autoteste (Jogo de Teste, 28 s):**
| Situação | WGC janela | WGC monitor | DXGI |
|---|---|---|---|
| Tela cheia, jogo na frente | 143 fps | 143 fps | 144 fps |
| Tela cheia, **minimizado** (Alt+Tab) | abre, **0 quadros** | — | entrega a área de trabalho (imagem parada, sem o jogo) |
| Tela cheia, depois de voltar | 143 fps | — | 143 fps |
| Sem bordas, na frente | 143 fps | 143 fps | 144 fps |
Nenhuma imagem preta e nenhum erro. A volta para a tela cheia leva ~1 s (6 quadros no 1º segundo).

**Conclusão:** neste PC a captura de jogo em tela cheia funciona (nativa, a 144 fps) enquanto o jogo está na tela.
Só não existe imagem do jogo enquanto ele está minimizado, e é exatamente aí que o Chromium recusava começar
("Could not start video source"). Isso confirma a correção (esperar o jogo voltar e então começar).
Ainda falta: (1) transmitir o Valorant na Resenha com o servidor atualizado; (2) o mesmo autoteste num **Windows 10**.
Não medido aqui: uma sessão de WGC aberta com o jogo minimizado volta a entregar quadros quando ele é restaurado?
(o autoteste reabre a captura depois de voltar). Com a correção a transmissão só começa com o jogo na tela.

### 2026-11-17 · Windows 10 (19045) · AMD (AMDh264Encoder) · Need for Speed Rivals em tela cheia, 1080p60
Relatório: DXGI capturou **46** quadros/s, saíram **40**; `limit: cpu` (no nativo = codificador sem vaga de entrada,
quadros descartados); 7,5 Mbps; CPU do programa 6%; GPU do PC 80-90%. Imagem muito comprimida.
Mudanças: bitrate automático +50% para jogo a 60 FPS (1080p60: 7,2 -> 10,8 Mbps); camada leve na metade do FPS (as
duas camadas dividem o codificador); quadro que chega com o codificador ocupado espera a próxima vaga em vez de ser
descartado; prioridade ALTA de GPU para o processo (como o OBS) e a maior prioridade de thread de GPU aceita. Painel:
`encoderBusy`, `nativeKbps`, `nativePrio`. **Falta medir de novo** (precisa do app novo).
