# Tunnel-Firewall auf dem Homeserver

**Zielmaschine:** Homeserver-VM (Gameserver-VM auf Proxmox), Tunnel-Adresse `10.10.0.2`.
**Betrifft:** eingehende Verbindungen auf dem WireGuard-Interface `wg0`.

## Warum

Das Grundprinzip aus [PFLICHTENHEFT.md §1](../../PFLICHTENHEFT.md) verlangt: der
Homeserver nimmt **zu keinem Zeitpunkt** eingehende Verbindungen an – „weder vom Router
noch innerhalb des Tunnels". Der Agent baut die Verbindung zur VPS ausschließlich
**ausgehend** auf (`AGENT_BACKEND_WS_URL=ws://10.10.0.1:4000/agent`). Damit muss auf dem
Homeserver kein einziger Port für eingehende Verbindungen offen stehen – auch SSH-Port 22
nicht.

Steht SSH im Tunnel offen (Zustand aus Gefundenem Punkt 85, Nachlass der Einrichtung vom
2026-08-21), wird eine kompromittierte VPS zum Sprungbrett ins Heimnetz. Genau das schließt
die Architektur aus. Die Regel unten dichtet das ab: sie verwirft **jede** neu eingehende
Verbindung auf `wg0` und lässt nur Rückverkehr der vom Agent selbst aufgebauten Verbindungen
zu (zustandsbehaftet).

## Standard: eingehenden Verkehr auf `wg0` blockieren

Die Regel gehört an die vom Hand angelegte Tunnel-Konfiguration
**`/etc/wireguard/wg0.conf` auf dem Homeserver** und wird über `PostUp`/`PostDown` an den
Lebenszyklus des Tunnels gekoppelt – so gilt sie automatisch, sobald `wg-quick@wg0` läuft,
und verschwindet sauber beim Herunterfahren. Kein zusätzliches Paket nötig (`nftables` ist
auf aktuellen Distributionen vorhanden):

```ini
[Interface]
# ... Address = 10.10.0.2/24, PrivateKey, ... (unverändert)
PostUp = nft add table inet palantir_wg; nft add chain inet palantir_wg input '{ type filter hook input priority 0; policy accept; }'; nft add rule inet palantir_wg input iifname "wg0" ct state established,related accept; nft add rule inet palantir_wg input iifname "wg0" drop
PostDown = nft delete table inet palantir_wg
```

- Regel 1 lässt Rückverkehr der **ausgehenden** Agent-Verbindung durch (`established,related`).
- Regel 2 verwirft alles übrige, das neu über `wg0` hereinkommt – einschließlich Port 22.

Prüfen **auf dem Homeserver**, dass die Tabelle nach dem Tunnelstart steht:

```bash
nft list table inet palantir_wg
```

Gegenprobe **von der VPS aus** – SSH zum Homeserver muss ins Leere laufen (Timeout, nicht
„Connection refused"):

```bash
timeout 5 ssh 10.10.0.2 || echo 'blockiert (erwartet)'
```

### Alternative für Hosts mit `ufw`

Nutzt der Homeserver bereits `ufw`, genügt statt der `nft`-Zeilen:

```bash
ufw deny in on wg0
```

Der minimale Sonderfall (nur SSH sperren, restlicher eingehender Tunnelverkehr offen) wäre
`ufw deny in on wg0 to any port 22 proto tcp` – der volle `ufw deny in on wg0` ist aber die
Regel, die dem Grundprinzip entspricht, und sollte bevorzugt werden. `ufw` und die
`nft`-Variante nicht mischen; eine der beiden genügt.

## Ausnahme: bewusste Fernwartung (nur wenn nötig)

Ist Fernwartung des Homeservers per SSH zwingend nötig, wird sie **eng begrenzt** und
ausdrücklich freigeschaltet – nie als „Port 22 offen für alle im Tunnel".

Wichtig: Die Ausnahme darf **nicht** die VPS-Adresse `10.10.0.1` freigeben. Das würde genau
das Sprungbrett wiederherstellen, das §1 ausschließt (kompromittierte VPS erreicht Heimnetz).
Stattdessen bekommt der Wartungszugang einen **eigenen WireGuard-Peer** mit fester
Tunnel-Adresse (Beispiel `10.10.0.9`, Admin-Notebook), und nur diese Quelle darf Port 22:

```ini
# in /etc/wireguard/wg0.conf auf dem Homeserver, VOR der Drop-Zeile aus PostUp einfügen:
PostUp = nft add table inet palantir_wg; nft add chain inet palantir_wg input '{ type filter hook input priority 0; policy accept; }'; nft add rule inet palantir_wg input iifname "wg0" ct state established,related accept; nft add rule inet palantir_wg input iifname "wg0" ip saddr 10.10.0.9 tcp dport 22 accept; nft add rule inet palantir_wg input iifname "wg0" drop
```

- **Quell-IP:** `10.10.0.9` (dedizierter Wartungs-Peer, **nicht** die VPS).
- **Port:** `22/tcp`, sonst nichts.
- Jede so gesetzte Ausnahme ist in [PFLICHTENHEFT.md §2.1](../../PFLICHTENHEFT.md) mit
  Begründung zu vermerken; ohne Eintrag gilt der Standard-Block oben.
