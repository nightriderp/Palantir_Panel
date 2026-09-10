# Terraria – das erste Spiel ohne Laufzeit-Basis dazwischen.
#
# Es sitzt unmittelbar auf `palantir-base-linux`: Der Server bringt sein Mono
# und seine Bibliotheken selbst mit (`lib64/` im Archiv), es braucht also weder
# eine JVM noch SteamCMD noch .NET aus dem Image. Genau für diesen Fall ist die
# Wurzel gedacht (`images/README.md`).
#
# **Die Serverdateien liegen nicht im Image.** Re-Logic gibt den dedizierten
# Server unter einer festen Adresse heraus, aber nicht zur Weitergabe frei; das
# Startskript holt das Archiv beim ersten Start in den Datenordner und prüft es
# gegen die SHA-256 unten. Adresse, Bau und Prüfsumme stehen hier und gehören
# damit zum Image-Tag – wer die Fassung wechselt, tauscht alle drei und erhöht
# `VERSION`.
#
# Neue Werte holen (die Bau-Nummer ist die Fassung ohne Punkte: 1.4.5.8 → 1458;
# die höchste, die mit 200 antwortet, ist die aktuelle):
#
#   curl -sIo /dev/null -w '%{http_code}\n' \
#     https://terraria.org/api/download/pc-dedicated-server/terraria-server-1459.zip
#   curl -sL https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip \
#     | sha256sum
#
# **`BASIS` zeigt auf `:2`,** nicht auf `:1`: Erst diese Fassung bringt `unzip`
# mit, und ohne das lässt sich das Archiv in einer POSIX-Shell nicht auspacken.
ARG BASIS=ghcr.io/nightriderp/palantir-base-linux:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt das
# Ausführungsbit nicht mit, und ein Image, das je nach Auscheck-Plattform anders
# aussieht, ist keins. `palantir-console` samt Verweis kommt aus der Wurzel.
RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

ENV TERRARIA_BUILD=1458
ENV TERRARIA_URL=https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip
ENV TERRARIA_SHA256=f513a4ac9789d34af766291ae217c9cd7d9472e13782a0e2b17512f70d7a8334

# Der Spielport ist TCP – Terraria ist eines der wenigen Spiele, bei denen der
# Health-Check des Panels deshalb mit einem reinen Verbindungsversuch auskommt
# (`query.kind: 'portConnect'` in der Spieltyp-Definition).
EXPOSE 7777

# **Kein `exec` am Ende des Startskripts, und das ist hier richtig.**
# Terraria speichert bei SIGTERM nicht – die Welt ist dann auf dem Stand des
# letzten selbsttätigen Speicherns. Gespeichert wird beim Befehl `exit`. Das
# Startskript fängt das Signal deshalb ab, schickt `exit` in die Konsole und
# wartet auf den Server; die Kulanzzeit dafür setzt `stopTimeoutSeconds` in der
# Spieltyp-Definition. Ausführlich steht das in `start.sh` und in der README.
ENTRYPOINT ["/opt/palantir/start.sh"]
