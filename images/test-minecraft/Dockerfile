# Test-Spielserver mit Minecraft-Protokoll (Gefundener Punkt 113).
#
# Kein Spielserver - ein Prüfstand für die Kette des Panels: Portvergabe,
# Weiterleitung über frp, Subdomain, Abfrage über gamedig, Konsole, Live-Logs,
# Auto-Shutdown, Datenordner. Was ein echtes Spiel-Image erfüllen muss, steht in
# SPIEL_IMAGES.md; dieses Image hält dieselben Regeln ein, damit der Prüfstand
# etwas wert ist.
FROM node:22-alpine

# Feste, nicht-root Identität. `node` ist in diesem Image 1000:1000 - genau die
# UID, der der Datenordner auf dem Homeserver gehört (Gefundener Punkt 117).
# Kein Benutzerwechsel zur Laufzeit, kein chown im Start: beides scheitert an
# `no-new-privileges` und `CapDrop: ALL` (Pflichtenheft §2.3).
USER node

# Alles Veränderliche liegt im Datenordner; das Wurzeldateisystem darf
# schreibgeschützt sein.
WORKDIR /data

COPY --chown=node:node server.mjs console.mjs /opt/palantir/

# Der Konsolen-Anschluss muss ohne Shell aufrufbar sein (EXEC_CONSOLE gibt eine
# Argumentliste, kein Kommando für `sh -c`).
USER root
RUN printf '#!/bin/sh\nexec node /opt/palantir/console.mjs "$@"\n' > /usr/local/bin/palantir-console \
  && chmod 0755 /usr/local/bin/palantir-console
USER node

EXPOSE 25565

# Sauberes Beenden: Das Signal muss beim Node-Prozess ankommen, deshalb die
# exec-Form ohne Shell dazwischen.
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/opt/palantir/server.mjs"]
