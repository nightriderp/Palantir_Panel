#!/usr/bin/env bash
# Setzt die Demo-Bühne von Grund auf neu auf: Wegwerf-Datenbank, Migrationen,
# Seed, Owner-Konto, Demo-Zustand. Danach läuft alles für die Aufnahme.
#
# ⚠️ Löscht die Datenbank aus umgebung.sh vollständig. Sie ist eine
# Wegwerf-Datenbank für Aufnahmen – nie eine Installation mit echten Daten.
set -euo pipefail

hier="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wurzel="$(cd "$hier/../.." && pwd)"
# shellcheck source=/dev/null
. "$hier/umgebung.sh"

datenbank="${DATABASE_URL##*/}"
echo "Setze Datenbank „$datenbank\" neu auf."

"$hier/buehne.sh" stop || true
rm -f "$hier/.lauf/demo-node.json"

# Verbindungen einer vorherigen Aufnahme trennen – sonst verweigert Postgres
# das Löschen, und der Aufbau bricht an einer Stelle ab, die nichts damit zu tun hat.
su postgres -c "psql -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$datenbank' AND pid <> pg_backend_pid();\"" >/dev/null
su postgres -c "dropdb --if-exists $datenbank"
su postgres -c "createdb -O palantir $datenbank"

cd "$wurzel"
pnpm --filter @palantir/backend db:migrate
pnpm --filter @palantir/backend db:seed

"$hier/buehne.sh" start

# Das Owner-Konto registriert sich wie jedes andere und wird anschließend über
# das Backend-Kommando gehoben – derselbe Weg wie in deploy/README.md §6.
node -e "
import('$hier/api.mjs').then(async ({ PanelClient }) => {
  const c = new PanelClient('http://127.0.0.1:4000');
  await c.registrieren('mika', 'Palantir-Demo-2026!', 'Mika');
  console.log('Owner-Konto registriert.');
});
"
pnpm --filter @palantir/backend db:owner mika

node "$hier/daten.mjs"
