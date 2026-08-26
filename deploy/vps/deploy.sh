#!/usr/bin/env bash
#
# Palantir - Deployment auf der VPS.
#
# Wird NICHT von Hand aufgerufen, sondern über SSH aus der Pipeline. In der
# authorized_keys des Deploy-Benutzers ist dieser Pfad als erzwungenes Kommando
# hinterlegt:
#
#   command="/opt/palantir/deploy/vps/deploy.sh",no-agent-forwarding,\
#   no-port-forwarding,no-pty,no-user-rc ssh-ed25519 AAAA...
#
# Dadurch kann ein abhandengekommener Schlüssel genau eines: dieses Skript
# ausführen. Keine Shell, keine Portweiterleitung. Der gewünschte Commit kommt
# über SSH_ORIGINAL_COMMAND - siehe Prüfung weiter unten.
#
# Von Hand (zum Nachstellen) geht auch:
#   sudo -u palantir-deploy /opt/palantir/deploy/vps/deploy.sh <commit-sha>

set -euo pipefail

REPO_DIR="${PALANTIR_REPO_DIR:-/opt/palantir}"
COMPOSE_DIR="${REPO_DIR}/deploy/vps"
ENV_FILE="${REPO_DIR}/.env"
LOCK_FILE="/tmp/palantir-deploy.lock"

log() { printf '[deploy %s] %s\n' "$(date -u '+%H:%M:%S')" "$1"; }
fail() {
  printf '[deploy FEHLER] %s\n' "$1" >&2
  exit 1
}

# -----------------------------------------------------------------------------
# 1. Eingabe prüfen
# -----------------------------------------------------------------------------
# Der Commit kommt über das Netz. Er wird gleich an git weitergereicht, deshalb
# wird er streng geprüft statt nur zitiert: ausschließlich 40 hexadezimale
# Zeichen. Alles andere - Optionen, Pfade, Befehlstrenner - fällt hier durch.
ziel="${1:-${SSH_ORIGINAL_COMMAND:-}}"
ziel="$(printf '%s' "${ziel}" | tr -d '[:space:]')"

[[ -n "${ziel}" ]] || fail 'Kein Commit angegeben.'
[[ "${ziel}" =~ ^[0-9a-f]{40}$ ]] || fail "Kein gültiger Commit-SHA: '${ziel}'"

# -----------------------------------------------------------------------------
# 2. Gegen gleichzeitige Läufe sichern
# -----------------------------------------------------------------------------
# Zwei Deployments gleichzeitig würden sich beim Auschecken und beim Neustart
# der Container in die Quere kommen.
exec 9>"${LOCK_FILE}"
flock -n 9 || fail 'Es läuft bereits ein Deployment.'

log "Ziel-Commit: ${ziel}"

[[ -d "${REPO_DIR}/.git" ]] || fail "${REPO_DIR} ist keine Git-Auscheckung."
[[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} fehlt - siehe SETUP.md Abschnitt 1."

vorher="$(git -C "${REPO_DIR}" rev-parse HEAD)"
log "Aktueller Stand: ${vorher}"

# -----------------------------------------------------------------------------
# 3. Stand holen
# -----------------------------------------------------------------------------
# Nur der Compose-Aufbau und die Migrationen kommen aus dem Repository - der
# Anwendungscode steckt in den Images. Deshalb genügt ein flaches Holen.
log 'Hole den Ziel-Commit ...'
git -C "${REPO_DIR}" fetch --quiet --depth=1 origin "${ziel}"
git -C "${REPO_DIR}" checkout --quiet --detach "${ziel}"

# -----------------------------------------------------------------------------
# 4. Images holen und Stack starten
# -----------------------------------------------------------------------------
# Die .env wird NICHT angefasst (Pflichtenheft §12.1) - sie enthält alle
# Geheimnisse und wird von Hand gepflegt. Die Fassung kommt stattdessen als
# Umgebungsvariable; sie hat in docker compose Vorrang vor der --env-file.
#
# `prod` zeigt zu diesem Zeitpunkt bereits auf genau diesen Commit: die Pipeline
# hängt das Tag vor dem Aufruf um, ohne neu zu bauen (docs/ci-cd.md §4).
cd "${COMPOSE_DIR}"

log 'Hole die Images ...'
PALANTIR_VERSION=prod docker compose --env-file "${ENV_FILE}" pull --quiet

# `up -d` wendet über den Dienst `migrate` zuerst die Migrationen an; Backend und
# Frontend warten per service_completed_successfully darauf. Die Reihenfolge
# steht in der Compose-Datei, nicht hier.
log 'Starte den Stack ...'
PALANTIR_VERSION=prod docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

# -----------------------------------------------------------------------------
# 5. Ergebnis prüfen
# -----------------------------------------------------------------------------
# Ohne diese Prüfung meldet die Pipeline Erfolg, sobald die Container gestartet
# sind - auch wenn das Backend gleich darauf in einer Absturzschleife hängt.
log 'Warte auf gesunde Dienste ...'
for versuch in $(seq 1 30); do
  ungesund="$(docker compose --env-file "${ENV_FILE}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null |
    awk '$2 != "healthy" && $2 != "" {print $1}' || true)"
  [[ -z "${ungesund}" ]] && break
  [[ "${versuch}" -eq 30 ]] && {
    log "Noch nicht gesund: ${ungesund}"
    docker compose --env-file "${ENV_FILE}" ps
    fail 'Dienste wurden nicht rechtzeitig gesund. Der vorherige Stand läuft NICHT mehr - siehe Rückfall unten.'
  }
  sleep 5
done

log 'Alle Dienste gesund.'
docker compose --env-file "${ENV_FILE}" ps --format 'table {{.Service}}\t{{.Status}}'

log "Fertig: ${vorher} -> ${ziel}"

# Rückfall (von Hand, siehe docs/ci-cd.md §4): In GHCR das Tag `prod` auf den
# vorherigen SHA umhängen und dieses Skript mit ebendiesem SHA erneut aufrufen.
# Achtung: Migrationen sind vorwärtsgerichtet - ein Rückfall der Anwendung setzt
# voraus, dass die Migrationen abwärtskompatibel geschrieben wurden.
