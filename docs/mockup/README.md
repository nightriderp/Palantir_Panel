# Mockup

Referenzentwurf des Mockups (lag urspruenglich als `MockUp.zip` im Repo-Root). Referenz für alle Frontend-Arbeitspakete
F1–F11 aus [STRUKTUR.md](../../STRUKTUR.md).

| Datei | Inhalt |
|---|---|
| `Palantir.dc.html` | Vollständiger interaktiver Entwurf der Oberfläche |
| `ServerCard.dc.html` | Einzelentwurf der `ServerCard` – Ausgangspunkt für F2 |
| `support.js` | Laufzeit für die beiden `.dc.html`-Dateien, muss danebenliegen |
| `screenshots/` | Vier Detailaufnahmen (Debug-Ansicht, Icon-Check, Verwalten-Ansicht) |

## Ansehen

`Palantir.dc.html` im Browser öffnen. `support.js` wird relativ geladen – die Datei
also nicht einzeln verschieben.

## Beobachtungen aus der Datei

Verifiziert durch Lesen von `Palantir.dc.html`, nicht geraten:

- **Schriften:** Space Grotesk (400/500/600/700) und JetBrains Mono (400/500/600),
  eingebunden über Google Fonts.
- **Aufbau:** ein einzelnes Dokument mit Template-Logik (`sc-if`, `sc-for`,
  `{{ platzhalter }}`), keine getrennten Artboards pro Seite. Die Ansichten schalten
  über Zustände im Dokument um.
- **Umfang:** rund 110 Buttons, 39 Eingabefelder, 7 Select-Felder, 4 Formulare – das
  Mockup deckt also deutlich mehr als eine Ansicht ab.
- Farben stehen als literale Werte im Markup, nicht als CSS-Custom-Properties. Die
  Design-Tokens müssen in F2 erst daraus abgeleitet werden
  (`apps/frontend/tailwind.config.ts`).

## Verbindlichkeit

Das Mockup ist Orientierung für Layout und Gestaltung. Bei Widersprüchen zwischen Mockup
und [LASTENHEFT.md](../../LASTENHEFT.md) / [PFLICHTENHEFT.md](../../PFLICHTENHEFT.md)
gelten die beiden Dokumente – im Zweifel nachfragen statt eigenmächtig interpretieren
([CLAUDE.md](../../CLAUDE.md)).
