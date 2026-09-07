#!/usr/bin/env bash
#
# Palantir - Selbstaktualisierung der Gamenode.
#
# Läuft in der Gameserver-VM, angestoßen vom systemd-Timer daneben.
#
# WARUM ZIEHEN STATT SCHICKEN: Pflichtenheft §1 - der Homeserver nimmt zu keinem
# Zeitpunkt eingehende Verbindungen an, auch nicht aus dem WireGuard-Tunnel. Ein
# Deployment per SSH wie auf der VPS ist hier also ausgeschlossen. Die Node holt
# sich ihren Stand selbst; alle Verbindungen gehen nach außen.
#
# Der Agent ist die einzige Komponente, die sich selbst aktualisieren muss. Die
# Gameserver-Container werden NICHT deployt - die steuert das Panel zur Laufzeit
# über das Agent-Protokoll.
#
# Der freigegebene Stand steht im Git-Zweig `prod`: den setzt die Pipeline nach
# der Freigabe auf denselben Commit, auf den auch das Image-Tag `prod` zeigt -
# und zwar erst, nachdem die VPS erfolgreich ausgerollt wurde.
#
# ZUSTAND IST DIE ERFOLGSMARKE, NICHT HEAD: Was tatsaechlich laeuft, steht in
# `.deployed-sha` und wird erst geschrieben, wenn die Dienste danach auch
# hochgekommen sind. HEAD allein taugt dafuer nicht - nach einem Fehlschlag
# stuende er auf dem neuen Commit, der naechste Lauf faende "unveraendert" und
# die Node bliebe still auf dem alten Agent stehen.

set -euo pipefail

REPO_DIR="${PALANTIR_REPO_DIR:-/opt/palantir}"
COMPOSE_DIR="${REPO_DIR}/deploy/gamenode"
ENV_FILE="${REPO_DIR}/.env"
ZWEIG="${PALANTIR_BRANCH:-prod}"
MARKE="${REPO_DIR}/.deployed-sha"

log() { printf '[update %s] %s\n' "$(date -u '+%H:%M:%S')" "$1"; }
fail() {
  printf '[update FEHLER] %s\n' "$1" >&2
  exit 1
}

# Sperrdatei bewusst NICHT in /tmp - und auch nicht in /run/lock, das auf Debian
# und Ubuntu ebenso world-writable mit Sticky-Bit ist. Legt dort ein beliebiger
# lokaler Nutzer die Datei vorher mit Modus 600 an, scheitert das `exec 9>`
# unten, der Lauf endet mit "Ein Lauf ist noch aktiv" und die Node aktualisiert
# sich nie wieder - ohne Fehlerstatus. `/run/palantir` legt systemd ueber
# `RuntimeDirectory=palantir` als root:root 0755 an; ausserhalb von systemd
# bleibt das Repo-Verzeichnis, das ohnehin nur dem Deploy-Konto gehoert.
sperrpfad() {
  if [[ -d /run/palantir && -w /run/palantir ]]; then
    printf '%s' '/run/palantir/update.lock'
  elif [[ -n "${XDG_RUNTIME_DIR:-}" && -d "${XDG_RUNTIME_DIR}" && -w "${XDG_RUNTIME_DIR}" ]]; then
    printf '%s' "${XDG_RUNTIME_DIR}/palantir-update.lock"
  else
    printf '%s' "${REPO_DIR}/.update.lock"
  fi
}
LOCK_FILE="${PALANTIR_LOCK_FILE:-$(sperrpfad)}"

exec 9>"${LOCK_FILE}"
flock -n 9 || {
  log 'Ein Lauf ist noch aktiv - übersprungen.'
  exit 0
}

[[ -d "${REPO_DIR}/.git" ]] || fail "${REPO_DIR} ist keine Git-Auscheckung."
[[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} fehlt - siehe SETUP.md."

vorher="$(git -C "${REPO_DIR}" rev-parse HEAD)"

# Bisher ausgerollter Stand laut Erfolgsmarke. Fehlt sie (erster Lauf mit dieser
# Fassung), gilt HEAD als bisheriger Stand - dann verhaelt sich das Skript wie
# zuvor, ohne unnoetig einmal alles neu zu starten.
ausgerollt="$(cat "${MARKE}" 2>/dev/null || true)"
[[ "${ausgerollt}" =~ ^[0-9a-f]{40}$ ]] || ausgerollt="${vorher}"

# Erst holen, dann vergleichen, dann auschecken - in dieser Reihenfolge. Der
# Vergleich muss auf einem frisch geholten `origin/<zweig>` beruhen, sonst
# entscheidet das Skript anhand eines veralteten Standes.
log "Pruefe Zweig '${ZWEIG}' ..."
git -C "${REPO_DIR}" fetch --quiet origin "${ZWEIG}"
ziel="$(git -C "${REPO_DIR}" rev-parse "origin/${ZWEIG}")"

# Der übliche Fall: nichts hat sich geändert. Dann wird nichts angefasst - kein
# Neustart der Container, keine Unterbrechung laufender Gameserver. Geprueft
# werden beide Groessen: die Marke (was laeuft) und HEAD (was ausgecheckt ist).
if [[ "${ausgerollt}" == "${ziel}" && "${vorher}" == "${ziel}" ]]; then
  log "Unverändert (${ziel:0:12}) - nichts zu tun."
  exit 0
fi

log "Neuer Stand: ${ausgerollt:0:12} -> ${ziel:0:12}"

# Ab hier wird die Auscheckung veraendert. Scheitert danach irgendetwas (die
# Registry ist nicht erreichbar, das Login unter /etc/palantir/docker ist
# abgelaufen, der neue Agent kommt nicht hoch), muss HEAD zurueck auf den Stand
# von vorher: Sonst passen Auscheckung und laufende Container nicht zusammen und
# der naechste Lauf haelt den fehlgeschlagenen Stand fuer erledigt.
zuruecksetzen() {
  local ausgang=$?
  if [[ "${ausgang}" -ne 0 ]]; then
    log "Fehlgeschlagen (Status ${ausgang}) - setze die Auscheckung auf ${vorher:0:12} zurueck."
    git -C "${REPO_DIR}" checkout --quiet --detach "${vorher}" ||
      log 'Zuruecksetzen misslungen - Auscheckung von Hand pruefen.'
  fi
  exit "${ausgang}"
}
trap zuruecksetzen EXIT

git -C "${REPO_DIR}" checkout --quiet --detach "${ziel}"

cd "${COMPOSE_DIR}"

log 'Hole die Images ...'
docker compose --env-file "${ENV_FILE}" pull --quiet

# Nur Agent und Socket-Proxy werden neu gestartet. Die Gameserver-Container
# gehören nicht zu diesem Compose-Projekt und laufen unberührt weiter - ein
# Update des Agents darf keine laufende Spielrunde beenden.
log 'Starte die Dienste der Gamenode neu ...'
docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

# -----------------------------------------------------------------------------
# Ergebnis pruefen
# -----------------------------------------------------------------------------
# Ohne diese Pruefung meldet der Lauf "Fertig", sobald `up -d` zurueckkommt -
# auch wenn der neue Agent sofort mit "Ungueltige Umgebungskonfiguration"
# abbricht und in der `restart: always`-Schleife haengt. Die Node waere dann
# offline, bis jemand ins Panel schaut.
#
# Kein Dienst dieses Stacks bringt heute einen Healthcheck mit. Ein fehlender
# Healthcheck wird deshalb ausdruecklich gemeldet und nicht stillschweigend als
# "gesund" verbucht; bewertet wird in dem Fall der Zustand des Containers.
log 'Warte auf betriebsbereite Dienste ...'
erfolge=0
for versuch in $(seq 1 24); do
  # Kein `|| true`: Faellt `ps` selbst aus (Docker-Daemon weg, Compose-Datei
  # kaputt), ist der Zustand unbekannt - und unbekannt ist nicht gesund.
  # `{{.Health}}` steht als letztes Feld, weil genau dieses leer sein kann:
  # `read` fasst mehrere Trennzeichen zusammen, in der Mitte wuerde ein leerer
  # Wert also die folgenden Felder verschieben.
  if ! zeilen="$(docker compose --env-file "${ENV_FILE}" ps --all \
    --format '{{.Service}} {{.State}} {{.ExitCode}} {{.Health}}')"; then
    fail 'docker compose ps ist fehlgeschlagen - der Zustand der Dienste ist unbekannt.'
  fi

  gezaehlt=0
  ungesund=''
  ohne_check=''
  while read -r dienst zustand code gesundheit; do
    [[ -n "${dienst}" ]] || continue
    gezaehlt=$((gezaehlt + 1))
    case "${gesundheit}" in
      healthy) ;;
      starting | unhealthy) ungesund+=" ${dienst}(${gesundheit})" ;;
      *)
        if [[ "${zustand}" == 'running' ]]; then
          ohne_check+=" ${dienst}"
        elif [[ "${zustand}" == 'exited' ]]; then
          # Einmalige Dienste beenden sich planmaessig; ein Rest mit Fehlercode
          # wird gemeldet, blockiert den Lauf aber nicht.
          [[ "${code}" == '0' ]] || log "Hinweis: ${dienst} ist mit Code ${code} beendet."
        else
          ungesund+=" ${dienst}(${zustand})"
        fi
        ;;
    esac
  done <<<"${zeilen}"

  if [[ "${gezaehlt}" -eq 0 ]]; then
    ungesund=' (kein einziger Dienst gefunden)'
  fi

  if [[ -z "${ungesund}" ]]; then
    erfolge=$((erfolge + 1))
    # Zweimal hintereinander: Ein Container in der Absturzschleife ist zwischen
    # zwei Neustarts kurz "running" und saehe bei einer einzelnen Stichprobe
    # in Ordnung aus.
    if [[ "${erfolge}" -ge 2 ]]; then
      break
    fi
  else
    erfolge=0
  fi

  if [[ "${versuch}" -eq 24 ]]; then
    log "Nicht betriebsbereit:${ungesund}"
    docker compose --env-file "${ENV_FILE}" ps --all
    fail 'Die Dienste der Gamenode sind nicht rechtzeitig hochgekommen.'
  fi
  sleep 5
done

if [[ -n "${ohne_check}" ]]; then
  log "Ohne Healthcheck - nur der Zustand wurde geprueft:${ohne_check}"
fi

log 'Zustand:'
docker compose --env-file "${ENV_FILE}" ps --format 'table {{.Service}}\t{{.Status}}'

# Erst jetzt, nach `up -d` und Ergebnispruefung, gilt der Stand als ausgerollt.
printf '%s\n' "${ziel}" > "${MARKE}"

log "Fertig: ${ziel:0:12}"
