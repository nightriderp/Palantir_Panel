#!/usr/bin/env bash
# Startet und stoppt die Demo-Bühne: Backend, Demo-Node und Frontend.
#
# Gestartet wird jeweils **direkt der Node-Prozess**, nicht über eine
# pnpm-Hülle: Sonst steht in der Kennungsdatei die Hülle, und ein `stop`
# beendet sie, während der eigentliche Dienst weiterläuft und den Port hält.
# Genau so liefen hier zwei Backends gleichzeitig – das zweite band den Port
# nicht mehr und beendete sich, bedient wurde weiter vom ersten mit veraltetem
# Zustand. Zur Sicherheit gibt `stop` die Ports anschließend noch einmal frei.
set -euo pipefail

hier="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wurzel="$(cd "$hier/../.." && pwd)"
lauf="$hier/.lauf"
mkdir -p "$lauf"

# shellcheck source=/dev/null
[ -f "$hier/umgebung.sh" ] && . "$hier/umgebung.sh"

tsx_cli="$(ls -d "$wurzel"/node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs | head -1)"
next_cli="$wurzel/apps/frontend/node_modules/next/dist/bin/next"
PORTS=(4000 4500 3000 25565)

starte() {
  local name="$1" verzeichnis="$2"; shift 2
  if läuft "$name"; then echo "$name läuft bereits (PID $(cat "$lauf/$name.pid"))."; return; fi
  ( cd "$verzeichnis" && nohup "$@" >"$lauf/$name.log" 2>&1 & echo $! >"$lauf/$name.pid" )
  echo "$name gestartet (PID $(cat "$lauf/$name.pid"))."
}

läuft() {
  [ -f "$lauf/$1.pid" ] && kill -0 "$(cat "$lauf/$1.pid")" 2>/dev/null
}

warte_auf() {
  local adresse="$1" name="$2" versuche="${3:-60}"
  for _ in $(seq 1 "$versuche"); do
    if curl -fsS -o /dev/null -m 2 "$adresse"; then echo "$name ist bereit."; return 0; fi
    sleep 2
  done
  echo "$name antwortet nicht auf $adresse – siehe $lauf/${name,,}.log" >&2
  return 1
}

case "${1:-start}" in
  start)
    starte backend "$wurzel/apps/backend" node "$tsx_cli" src/index.ts
    warte_auf "http://127.0.0.1:4000/health" Backend
    starte demo-node "$wurzel" node werbevideo/buehne/demo-node.mjs
    warte_auf "http://127.0.0.1:4500/zustand" Demo-Node 15
    # Für die Aufnahme läuft das Frontend als **Produktionsbau**: Der
    # Entwicklungsbetrieb blendet ein Abzeichen ein, hält eine eigene
    # Aktualisierungsverbindung offen und baut jede Seite beim ersten Aufruf
    # neu - im Video sieht man das an hängenden Übergängen.
    if [ -f "$wurzel/apps/frontend/.next/BUILD_ID" ]; then
      starte frontend "$wurzel/apps/frontend" env NODE_ENV=production node "$next_cli" start -p 3000 -H 127.0.0.1
    else
      echo "Kein Produktionsbau vorhanden – starte den Entwicklungsbetrieb. Für Aufnahmen: $0 bauen"
      starte frontend "$wurzel/apps/frontend" node "$next_cli" dev -p 3000 -H 127.0.0.1
    fi
    warte_auf "http://127.0.0.1:3000/login" Frontend 90
    ;;
  stop)
    for name in frontend demo-node backend; do
      if [ -f "$lauf/$name.pid" ]; then
        pkill -TERM -P "$(cat "$lauf/$name.pid")" 2>/dev/null || true
        kill "$(cat "$lauf/$name.pid")" 2>/dev/null || true
        rm -f "$lauf/$name.pid"
        echo "$name beendet."
      fi
    done
    sleep 1
    # Was jetzt noch auf einem der Ports sitzt, gehört zu einer früheren
    # Aufnahme und wäre beim nächsten Start genau der Doppelgänger von oben.
    for port in "${PORTS[@]}"; do fuser -k "$port/tcp" 2>/dev/null || true; done
    ;;
  bauen)
    # `NODE_ENV` darf hier nicht auf `development` stehen: Next.js baut sonst
    # gegen die Entwicklungsfassung von React und bricht beim Vorrendern ab.
    ( cd "$wurzel/apps/frontend" && env -u NODE_ENV node "$next_cli" build )
    ;;
  status)
    for name in backend demo-node frontend; do
      if läuft "$name"; then echo "$name: läuft (PID $(cat "$lauf/$name.pid"))"; else echo "$name: aus"; fi
    done
    ;;
  *)
    echo "Aufruf: $0 {start|stop|status|bauen}" >&2; exit 2;;
esac
