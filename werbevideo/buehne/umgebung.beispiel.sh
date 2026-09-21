# Umgebung der Aufnahme-Installation.
#
# Kopieren nach `umgebung.sh` und die Werte setzen. Die Kopie bleibt lokal
# (siehe .gitignore) – dieselbe Regel wie für die zentrale `.env` im Repo-Root
# (Pflichtenheft §12.1): Geheimnisse liegen nie im Repository, auch keine, die
# "nur für eine Aufnahme" gelten. Ein Token, das einmal in der Historie steht,
# steht für immer darin.
#
# Die Werte hier gehören zu einer **Wegwerf-Installation** auf dem
# Aufnahmerechner. Nie gegen eine Installation mit echten Daten richten.

# Node 24 (siehe .nvmrc). Pfad ggf. anpassen.
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH

# Wegwerf-Datenbank. Wird von zuruecksetzen.sh vollständig gelöscht.
export DATABASE_URL="postgres://palantir:palantir@127.0.0.1:5432/palantir_demo"

# Diese Domain steht im Video an jedem Server – hier gehört eure echte hinein.
# Die Unteradressen müssen auf den Aufnahmerechner zeigen (/etc/hosts).
export PALANTIR_DOMAIN=palantir.example
export GAME_ROUTER_HOSTNAME=router.palantir.example

export PUBLIC_WEB_URL=http://127.0.0.1:3000
export PUBLIC_API_URL=http://127.0.0.1:4000
export NEXT_PUBLIC_API_URL=http://127.0.0.1:4000
export NEXT_PUBLIC_BASE_DOMAIN=palantir.example
export BACKEND_HOST=127.0.0.1
export BACKEND_PORT=4000

# Geheimnisse dieser Aufnahme. Neu erzeugen mit:
#   openssl rand -hex 32
export JWT_SECRET=hier-ein-eigenes-geheimnis-einsetzen
export CSRF_SECRET=hier-ein-eigenes-geheimnis-einsetzen
export ALTCHA_HMAC_KEY=hier-ein-eigenes-geheimnis-einsetzen
export AGENT_TOKEN=hier-ein-eigenes-token-einsetzen

# Ohne TLS auf 127.0.0.1; laut Pflichtenheft §7 nur außerhalb der Produktion.
export COOKIE_SECURE=false
export COOKIE_DOMAIN=
export NODE_ENV=development
export LOG_LEVEL=warn

# Die Attrappe des Backends bleibt aus: Die Node bedient die Demo-Node aus
# diesem Ordner, und ein verbundener Agent gewinnt gegen die Attrappe ohnehin.
export DEV_FAKE_AGENT=false

# Alle Spiele freischalten und den Rechenaufwand des ALTCHA-Widgets klein
# halten – im Video soll niemand auf ein Captcha warten.
export INSTALLATION_PHASE=3
export ALTCHA_COMPLEXITY=2000

# Der Health-Check fragt Server ohne Hostname-Routing hier ab.
export HEALTH_CHECK_HOST=127.0.0.1

# Spielports, auf denen die Demo-Node Abfragen beantwortet (Router-Port für
# Minecraft; weitere durch Komma getrennt).
export DEMO_SPIELPORTS=25565

# Damit die Konsolenzeilen des Spielservers dieselbe Uhr tragen wie das Panel:
# Ohne das stand im Video links die Berliner Zeit des Browsers und rechts in
# derselben Zeile die UTC-Zeit der Demo-Node - zwei Uhren nebeneinander.
export TZ=Europe/Berlin
