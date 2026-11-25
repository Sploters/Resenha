# Voz fora da VPN: servidor TURN

## Por que

O site e o chat chegam pelo Cloudflare Tunnel, mas a voz não: ela vai direto à porta 40000 do servidor, que anuncia só o
IP da VPN (Tailscale). Sem a VPN ligada, a voz fica em "Reconectando a voz…" (o popup do sinal mostra "Conexão —" e
"enviando ~0"). Abrir a porta no roteador não resolve quando a internet de casa tem **CGNAT**.

A saída é um **TURN** numa máquina com IP público (uma VPS) que também esteja no Tailscale:

```
pessoa sem VPN ──internet──▶ TURN (VPS, porta 3478) ──Tailscale──▶ Umbrel (SFU, porta 40000)
pessoa com VPN ──────────────────Tailscale──────────────────────▶ Umbrel (direto, como hoje)
```

- Quem está na VPN continua direto: o navegador só usa o TURN quando o caminho direto não funciona.
- O TURN só repassa para o IP do Umbrel (`allowed-peer-ip`): não vira um repetidor aberto para a internet.
- Cada pessoa recebe do servidor um usuário e senha temporários (48 h, `TURN_SECRET`), renovados a cada conexão.
- O IP de casa não aparece para ninguém: quem está fora da VPN só vê o IP da VPS.
- Peso: voz ~64 kbps por pessoa, transmissão de tela alguns Mbps. Escolha a VPS em **São Paulo** (cada ida e volta pelo
  TURN soma a distância até ele).

## 1. A VPS

Qualquer VPS Linux com IP público em São Paulo serve (1 núcleo e 1 GB sobram). Opção sem custo: **Oracle Cloud Always
Free**, região *Brazil East (São Paulo)*, imagem Ubuntu 24.04 (pede cartão no cadastro; a cota grátis de tráfego é bem
maior que o uso de um grupo de amigos). Se a Oracle não tiver máquina livre na região, uma VPS paga em São Paulo custa
alguns dólares por mês.

## 2. Tailscale na VPS

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

```bash
sudo tailscale up
```

Abra o link que aparecer e autorize na mesma conta do Umbrel. Anote os dois IPs da VPN (começam com `100.`):

```bash
tailscale ip -4
```

O do Umbrel aparece em `tailscale status` (ou no painel do Tailscale). Se você usa regras de acesso (ACL) no Tailscale,
libere a VPS para a porta 40000 do Umbrel.

## 3. coturn na VPS

```bash
sudo apt-get update && sudo apt-get install -y coturn
```

Gere o segredo (guarde: ele vai também no Umbrel):

```bash
openssl rand -hex 32
```

`/etc/turnserver.conf` (troque os três valores entre `< >`):

```
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=<segredo>
realm=resenha
# o relay sai pelo IP da VPS no Tailscale e só pode falar com o Umbrel
relay-ip=<IP da VPS no Tailscale>
denied-peer-ip=0.0.0.0-255.255.255.255
allowed-peer-ip=<IP do Umbrel no Tailscale>
min-port=49160
max-port=49200
no-cli
no-tls
no-dtls
no-multicast-peers
```

O coturn precisa do Tailscale de pé antes de abrir (o `relay-ip` é da VPN):

```bash
sudo systemctl edit coturn
```

Cole e salve:

```
[Unit]
After=tailscaled.service
Wants=tailscaled.service
[Service]
Restart=on-failure
RestartSec=5
```

```bash
sudo systemctl enable --now coturn && sudo systemctl restart coturn
```

## 4. Liberar a porta 3478 na VPS

Só a 3478 (UDP e TCP) precisa estar aberta para a internet; as portas do relay (49160-49200) falam só pelo Tailscale.

- **Oracle Cloud**: na rede da VM (VCN → Security List), regras de entrada para 3478/UDP e 3478/TCP de `0.0.0.0/0`. A
  imagem Ubuntu da Oracle também tem firewall próprio:

```bash
sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT && sudo iptables -I INPUT -p tcp --dport 3478 -j ACCEPT && sudo netfilter-persistent save
```

- Outras VPS: libere 3478/UDP e 3478/TCP no painel do provedor (e no `ufw`, se estiver ligado).

## 5. Ligar no Resenha (Umbrel)

No Umbrel, crie `~/resenha-voz.env` (fica fora do repositório, como o `~/resenha-steam.env`):

```
TURN_URL=turn:<IP público da VPS>:3478?transport=udp,turn:<IP público da VPS>:3478?transport=tcp
TURN_SECRET=<segredo>
```

Depois rode o deploy normal (`sh deploy/umbrel.sh`). O arquivo novo conta como "a voz mudou": o container é recriado
quando não houver conversa acontecendo (ou na hora com `FORCAR=1`).

## 6. Conferir

Com o Tailscale **desligado**, entre numa sala de voz pelo endereço público e clique no sinal de conexão: em "Conexão"
deve aparecer **UDP via TURN**. Se aparecer "A voz não conectou, nem pelo servidor TURN", confira a porta 3478 (passo 4)
e, na VPS, `sudo journalctl -u coturn -n 50`.

Variáveis (ver também [CONFIGURACAO.md](CONFIGURACAO.md)): `TURN_URL` (um ou mais, separados por vírgula),
`TURN_SECRET` (o `static-auth-secret` do coturn), `TURN_TTL_H` (validade da credencial, padrão 48 h). Sem
`TURN_SECRET`, `TURN_USER`/`TURN_PASS` continuam valendo como usuário e senha fixos.
