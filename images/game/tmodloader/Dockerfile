# Spiel-Image: tModLoader (`palantir-game-tmodloader`).
#
# Terraria mit Mod-Loader. Im Panel steht es als zweite Ausgabe unter der
# Terraria-Kachel; es ist aber ein eigenes Programm mit eigener Versionsfolge,
# eigener Laufzeit und einem eigenen Archiv — deshalb ein eigenes Image und
# keine Umgebungsvariable in `game/terraria`.
#
# **Warum `base/dotnet8` und nicht `base/dotnet`:** tModLoader verlangt in
# seiner `tModLoader.runtimeconfig.json` ausdrücklich Microsoft.NETCore.App
# 8.0.0 und rollt nicht auf 10 vor. Die Begründung steht ausführlich in
# `images/base/dotnet8/README.md`.
ARG BASIS=ghcr.io/nightriderp/palantir-base-dotnet8:1

FROM ${BASIS}
USER root

COPY start.sh /opt/palantir/
RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

# Version, Adresse und Prüfsumme des Archivs.
#
# **Das Archiv liegt nicht im Image**, anders als die Paper-Jar bei Minecraft:
# 61 MiB, und tModLoader veröffentlicht häufig. Es wird beim ersten Start in
# den Datenordner geholt und gegen diese Summe geprüft; was nicht dazu passt,
# wird verworfen statt ausgeführt. Der zweite Start lädt nichts mehr.
#
# Neue Version holen:
#
#   curl -s https://api.github.com/repos/tModLoader/tModLoader/releases/latest \
#     | jq -r '.tag_name, (.assets[] | select(.name == "tModLoader.zip") | .browser_download_url)'
#   curl -sL <url> | sha256sum
#
# Am 2026-09-21 gegen die Datei selbst gerechnet: 61.132.728 Bytes.
ENV TMODLOADER_VERSION=v2026.07.3.0
ENV TMODLOADER_URL=https://github.com/tModLoader/tModLoader/releases/download/v2026.07.3.0/tModLoader.zip
ENV TMODLOADER_SHA256=6f51610f4b0f167d1620d0e8c83264ba14e047421e97d9f8053eb40e3d764e1a

# Derselbe Port wie Terraria, ebenfalls TCP — der Health-Check kommt mit einem
# reinen Verbindungsversuch aus (`query.kind: 'portConnect'`).
EXPOSE 7777

# **Kein `exec` am Ende des Startskripts, und das ist hier richtig.**
# Wie Terraria speichert tModLoader bei SIGTERM nicht; gespeichert wird beim
# Befehl `exit`. Das Startskript fängt das Signal ab, schickt `exit` in die
# Konsole und wartet auf den Server. Die Kulanzzeit dafür setzt
# `stopTimeoutSeconds` in der Spieltyp-Definition.
ENTRYPOINT ["/opt/palantir/start.sh"]
