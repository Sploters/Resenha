# Proteção por voz (porta guiada por VAD)

Problema: com a redução de ruído por IA ligada, barulhos altos (escapamento de moto, latido) ainda vazavam. RNNoise e
GTCRN são modelos pequenos, bons contra ruído constante, mas só *reduzem* sons altos e repentinos: o que sobra de um som
de -20 dBFS continua audível. A porta de ruído antiga (por volume) abria com esse resto.

## Como funciona

Arquivos: `public/vadgate-core.js` (lógica pura), `public/vadgate-worklet.js` (AudioWorklet),
`public/vendor/ns/vadgate/rnnoise.js` (o carregador do RNNoise do pacote, exportado; gerado por
`scripts/vendor-rnnoise-vad.mjs`), `public/voice.js` (`buildChain`).

- **Modo RNNoise:** o nó da porta *é* o RNNoise. Limpa o áudio e usa a probabilidade de voz que `rnnoise_process_frame`
  já devolve (o nó original a descartava). Nada roda duas vezes.
- **Modo GTCRN:** um RNNoise à parte serve só de detector, analisando o microfone **antes** do GTCRN (entrada 2 do
  nó). Na saída do GTCRN o detector errava muito, e o atraso do GTCRN (~30 ms) vira antecedência para a porta, sem
  atraso a mais no áudio.
- A cada 10 ms, a porta:
  - **abre** com voz provável **e** nível acima do ruído de fundo;
  - **continua aberta** com voz provável acima do fundo (histerese: abrir pede mais que manter);
  - **segura** ~325 ms depois da última voz;
  - **fecha atenuando** 35 dB em rampa (abre em 5 ms, fecha em 150 ms). Não é mudo.
- **Ruído de fundo:** estatística de mínimo (o menor nível dos últimos 1,5 s, suavizado e com viés). Ventilador e
  zumbido viram fundo sozinhos.
- **Proteções para não cortar a fala:**
  - **Começo sem voz** ("s", "f", "ch"): subida sustentada com agudos abre a porta provisoriamente por 150 ms,
    esperando a vogal.
  - **Começo suave sem agudos:** abre só parcialmente (-15 dB na sensibilidade 50).
  - **Contexto de fala:** com ruído alto por cima da fala, o detector vacila. Se houve voz confirmada há menos de
    0,8 s, a porta segue aberta pelo nível.
- **Detector enganado:** se ele diz "voz" por 300 ms com o nível parado no fundo (zumbido tonal), abrir passa a pedir
  nível alto sustentado. Um clique não basta.
- **Graves dominando** (motor) só pedem mais certeza para abrir. Nunca bloqueiam sozinhos.

Configurações > Voz e vídeo: "Proteção por voz" (ligada por padrão com RNNoise/GTCRN) e a sensibilidade (0-100). A
sensibilidade muda ao vivo, sem refazer o microfone. `prefs.vadGate = false` volta exatamente à cadeia antiga.

## Medições (`node scripts/noise-bench.mjs`, resultado em `scripts/noise-bench.json`)

Áudio real: voz do MS-SNSD; latidos, motores, teclado e aspirador do ESC-50 (baixados na hora, fora do repositório).
Cada cenário é renderizado com a mesma cadeia do app.

Colunas:
- **ruído passa:** atenuação do ruído nas pausas (quanto mais negativo, melhor).
- **audível:** % dos quadros de ruído nas pausas acima de -55 dBFS.
- **cortada:** % da fala atenuada mais de 6 dB em relação à cadeia antiga.
- **início pior:** o pior começo de fala (só onde a cadeia antiga entregava algo audível).

| cenário | RNNoise antigo | RNNoise + voz | GTCRN antigo | GTCRN + voz |
|---|---|---|---|---|
| latido no silêncio: ruído passa / audível | -6,1 dB / 22,8% | -8,6 dB / 16,9% | -13,1 dB / 7,7% | **-27,8 dB / 2,9%** |
| moto no silêncio: ruído passa / audível | -25,8 dB / 6,1% | -27,1 dB / **1,7%** | -35,6 dB / 4,6% | **-43,0 dB / 0,5%** |
| aparelho ligado (aspirador): ruído passa | -12,9 dB | -19,4 dB | -25,4 dB | -34,3 dB |
| teclado + ventilador: ruído passa | -12,7 dB | -12,7 dB (sem ganho) | -33,9 dB | -33,9 dB |
| voz baixa e distante: cortada / início pior | 0 / 0 | 0,25% / -1,6 dB | 0 / 0 | 0,1% / -0,3 dB |
| fala com pausas: cortada / início pior | 0 / 0 | 0,05% / -0,7 dB | 0 / 0 | 0% / 0 dB |
| moto passando durante a fala: cortada | 0 | 3,1% | 0 | 2,8% |

A porta antiga (RNNoise + porta por volume a -45 dB), para comparação:
- corta o começo de fala inteiro na voz baixa (-150 dB) e na fala com pausas;
- deixa passar mais latido (23% audível) e mais moto (19% audível).

**Latência:** RNNoise 20,6 → 20 ms; GTCRN 31,9 → 31,9 ms (`scripts/vadgate-chain-test.mjs` confere).

**CPU em tempo real** (`scripts/noise-cpu.mjs`, % de um núcleo além de "sem filtro"):
- RNNoise: +3,1% → +3,7%.
- GTCRN: +6,6% → +9,9% (o detector RNNoise à parte).

### Limites conhecidos

- **Teclado no modo RNNoise:** o detector de voz do RNNoise confunde digitação com fala (~45% dos quadros). A porta
  não piora, mas também não ajuda. O GTCRN já remove teclado (-34 dB).
- **Latido no modo RNNoise:** o detector aceita ~9% dos quadros de latido como voz. Por isso o ganho é modesto lá; no
  GTCRN é grande. Testado e descartado: segurar menos depois de rajadas curtas (os latidos vazaram igual e a voz foi
  mais cortada).
- **Abertura provisória:** é uma troca. Salva começos de palavra que o detector demora a reconhecer, mas deixa passar
  o começo de cada latido (atenuado). Medido:
  - -12 dB: pior começo -12 dB; latido no GTCRN -25 dB.
  - desligada: pior começo -35 dB; latido -37 dB.
  - -15 dB (padrão): o meio. A sensibilidade move esse ponto.
- **Ruído branco artificial** e ronco grave sintético enganam o detector do RNNoise (ele os "limpa" deixando um som
  com formato de voz). Não aparece nas gravações reais.

## Quanto do problema sobra durante a fala (para decidir sobre o DeepFilterNet3)

A porta só age nas pausas: durante a fala ela fica aberta, e o ruído por cima da voz é o que o modelo deixa. Relação
voz/ruído na saída, durante a fala:

| cenário | entrada | RNNoise | GTCRN |
|---|---|---|---|
| moto passando (pico -16 dBFS) | -2,4 dB | 10,6 dB | 14,2 dB |
| latido por cima da fala | 7,8 dB | 12,0 dB | 18,9 dB |
| teclado + ventilador | 8,2 dB | 15,0 dB | 17,1 dB |

Com moto alta por cima da fala, o RNNoise deixa o ruído só ~10 dB abaixo da voz: claramente audível. Esse é o caso que
um modelo maior (DeepFilterNet3) atacaria. O GTCRN ganha ~4-7 dB sobre o RNNoise.

---

# Só a minha voz (trava na voz de quem está no microfone)

Pedido: a partir do "Forte", tirar também latido, moto e **outras vozes ao fundo** (principalmente femininas: namorada,
mãe) e desligar o ganho automático, que piorava tudo.

## Ganho automático desligado
`autoGainControl` do navegador aumentava o microfone nas pausas: o ruído e a voz de quem está ao fundo subiam junto, e o
nível que a porta usa ficava mudando. Agora vem desligado (`prefs.agc === true` liga). Quem já usava foi desligado uma
vez (`migrateAgc` em `public/app.js`, marca `agcV = 2`); depois vale a escolha da pessoa.

## Como funciona (`public/vadgate-core.js`, `lock: true`)
- **Tom da voz:** `createPitch` acha a frequência fundamental a cada 10 ms (autocorrelação normalizada, 60-450 Hz, em
  8 kHz) e a periodicidade. Medido nas amostras: vozes masculinas ~95-120 Hz, femininas ~185-225 Hz, latido 250-400 Hz
  com periodicidade baixa, motor sem tom de voz.
- **Aprende quem fala:** o volume típico da fala (~percentil 75 dos quadros de voz que passaram) e um histograma do tom
  (memória de ~6 s de vogais). Só fala contínua (≥ 200 ms) ensina o tom: latido é rajada curta.
- **Para abrir:** voz perto do seu volume (10 dB, sensibilidade 50) e sem 2 quadros seguidos com tom de outra pessoa
  (mais de 6,5 semitons do seu). Começo de palavra (volume ainda subindo) abre provisório por 60 ms e fecha se não chegar
  perto do seu volume; depois de uma provisória que falhou, só tenta de novo após 150 ms de silêncio.
- **Para manter:** até 16 dB abaixo do seu volume (fim de palavra) ou 14 dB no seu tom e limpo; outra pessoa falando
  (tom diferente) corta o "segurando" na hora.
- **Grito/risada:** tom mais alto, mas no seu volume e a até 13 semitons do seu: passa. Voz aguda (aprendida acima de
  160 Hz): uma oitava acima também é você (começo de frase subindo); voz grave não, porque uma oitava acima é justamente
  a voz feminina de fundo.
- **Aprendeu a pessoa errada** (a voz de fundo falou antes de você): a voz mais alta falando seguido com outro tom por
  ~250 ms faz a porta esquecer o tom e reaprender. Voz que ficou bem mais baixa de vez (trocou de microfone) desce o
  volume aprendido aos poucos depois de 3 s.
- Atenuação da porta fechada: -38,5 dB na sensibilidade 50 (era -35).
- Configurações > Voz e vídeo > "Só a minha voz" (**desligado por padrão** desde 2026-11-18; muda ao vivo).
  `prefs.voiceLock === true` liga.

### Correção: cortava a própria voz (2026-11-18)
Relato: perto do microfone, sala silenciosa, a voz ia baixando e ficava "robótica". Causa: o volume aprendido só subia
com os trechos mais altos da conversa; falando uns 14 dB mais baixo depois (afastar alguns centímetros de um microfone
perto da boca já dá isso), a sua voz ficava abaixo de `nearDb` e era tratada como voz de fundo: -38,5 dB, abrindo só em
pedaços de 60 ms. A liberação levava 2 s + 3 s e depois descia 5 dB/s, e qualquer sílaba que passava recomeçava a espera.
Simulação (mesma pessoa, falando a -16 dBFS e depois a -30 dBFS): **80% da fala abaixada → 16%**, só no primeiro ~1,5 s.
- No seu tom e com som de perto (`harm ≥ 0,7`), a voz abre até `ownNearDb` abaixo do volume aprendido (antes só mantinha).
- A sua própria fala também ensina o volume para baixo.
- Liberação: 1 s (`unlockMs`) e 25 dB/s (`unlockDb`); a contagem só zera depois de 1 s sem bloqueio.
- Troca: voz de fundo no mesmo tom e falando sem parar passa a passar depois de ~1 s (limite já conhecido).
- E a trava agora é opcional: quem estava no padrão fica com ela desligada.

## Medições
Simulador em Node com o mesmo RNNoise e a mesma porta (voz real do MS-SNSD; latido e motor do ESC-50; voz de fundo com
eco de sala), depois dos 3 primeiros segundos:

| cenário | sem trava: porta aberta / fundo | com trava |
|---|---|---|
| voz feminina ao fundo (-40 dBFS), você homem | 98% / 0 dB | **2,5% / -15,8 dB** |
| voz feminina no mesmo cômodo (-34 dBFS) | 99% / 0 dB | **7% / -12 dB** |
| voz masculina ao fundo, você homem | 96% / 0 dB | 9,5% / -6 dB |
| voz masculina ao fundo, você mulher | 97% / 0 dB | **4% / -11,5 dB** |
| latido (-22 dBFS, mais alto que a voz), você homem | 33% / -3,5 dB | 15% / -5,8 dB |

Sua fala: perda de energia 0,02-0,07 dB; começo de palavra depois de pausa longa -0,5 a -6 dB em média (sem trava -0,2
a -2).

`node scripts/noise-bench.mjs` (Chromium, cadeia do app; a voz de fundo fala ANTES de você, então o 1º trecho dela
passa enquanto a porta aprende):

| cenário | RNNoise + voz | RNNoise + trava | GTCRN + voz | GTCRN + trava |
|---|---|---|---|---|
| voz feminina ao fundo: ruído passa / audível | -0,3 dB / 93% | -4,4 dB / 35% | -4,1 dB / 53% | -7,7 dB / 28% |
| voz masculina ao fundo: ruído passa / audível | -1,1 dB / 81% | -5,2 dB / 32% | -1,7 dB / 78% | -7,1 dB / 30% |
| moto passando enquanto fala: ruído passa | -37,5 dB | **-76 dB** | -54,3 dB | **-92,7 dB** |
| teclado + ventilador: ruído passa / audível | -12,7 dB / 21% | -14,7 dB / 6,7% | -33,9 dB | -44,6 dB* |
| fala com pausas: início (média) | 0 dB | -6,1 dB | 0 dB | -2,7 dB |
| voz baixa e distante: início (média) | -0,3 dB | -1,3 dB | -0,1 dB | -0,8 dB |

\* rodado à parte: no fim de uma rodada longa o banco às vezes devolve silêncio no último cenário (também acontece sem a
trava; é do banco, não do filtro).

### Limites
- Voz de fundo **no mesmo tom e quase no mesmo volume** que a sua não tem como separar sem um modelo de reconhecimento
  de quem fala (o que existe hoje é pesado para rodar no aparelho de todo mundo).
- Os primeiros segundos: até você falar, a porta não sabe qual é a sua voz.
- Latido com tom perto do seu (voz feminina x cachorro de ~250 Hz) passa como antes.
- Duas pessoas no mesmo microfone: desligar "Só a minha voz".

# Transmissão de tela inteira com dois monitores (áudio "só desta tela")
O loopback por processo do Windows é "o programa **e todos os filhos dele**": não dá para pegar uma janela só. Por isso
vazava: o mesmo Chrome aberto nas duas telas (vídeo tocando no outro monitor), janela minimizada que estava no outro
monitor, ou um programa desta tela que abriu algo que está no outro (launcher, terminal). Agora o `lc-audio` informa os
ancestrais de cada processo (`anc`, por `CreateToolhelp32Snapshot`) e `desktop/appaudio.js screenPids` deixa de fora
qualquer programa com janela fora desta tela, os pais/avós deles, os pais/avós da própria Resenha e terminais. Troca:
um programa aberto nas duas telas fica mudo na transmissão (melhor que vazar).
