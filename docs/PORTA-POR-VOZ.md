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
