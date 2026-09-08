# Mitgelieferte Schriften

Diese sechs Schriften werden mit Palantir ausgeliefert. Sie liegen hier als
`woff2`, jeweils auf die lateinische Zeichenmenge beschränkt (`U+0000–00FF`,
deutsche Umlaute und ß eingeschlossen).

**Warum sie überhaupt hier liegen.** Bis dahin lud die Oberfläche ihre beiden
Schriften zur Laufzeit von einem fremden Host. Jeder Seitenaufruf teilte damit
die IP-Adresse des Betrachters einem Dritten mit, ohne dass jemand eingewilligt
hätte. Aus der eigenen Instanz ausgeliefert entfällt das, und eine Instanz ohne
Zugang zum offenen Internet sieht aus wie eine mit.

## Die Schriften

| Kennung                  | Datei                  | Familie        | Schnitte                         | Lizenz      | Urheber                            |
| ------------------------ | ---------------------- | -------------- | -------------------------------- | ----------- | ---------------------------------- |
| `bundled-space-grotesk`  | `space-grotesk.woff2`  | Space Grotesk  | variabel, 300–700                | SIL OFL 1.1 | The Space Grotesk Project Authors  |
| `bundled-jetbrains-mono` | `jetbrains-mono.woff2` | JetBrains Mono | variabel, 100–800, dicktengleich | SIL OFL 1.1 | The JetBrains Mono Project Authors |
| `bundled-chewy`          | `chewy.woff2`          | Chewy          | 400                              | Apache 2.0  | Font Diner, Inc. DBA Sideshow      |
| `bundled-audiowide`      | `audiowide.woff2`      | Audiowide      | 400                              | SIL OFL 1.1 | Brian J. Bonislawsky, Astigmatic   |
| `bundled-playpen-sans`   | `playpen-sans.woff2`   | Playpen Sans   | variabel, 100–800                | SIL OFL 1.1 | The Playpen Sans Project Authors   |
| `bundled-henny-penny`    | `henny-penny.woff2`    | Henny Penny    | 400                              | SIL OFL 1.1 | BrownFox                           |

Die vollständigen Lizenztexte liegen unter `lizenzen/`. Beide Lizenzen erlauben
das Mitliefern und Weitergeben ausdrücklich; beide verlangen, dass der
Lizenztext dabei erhalten bleibt. Genau dafür ist der Ordner da – er wird vom
Dockerfile mitkopiert und darf nicht aussortiert werden.

Die SIL Open Font License verbietet zusätzlich den Verkauf der Schriftdateien
für sich genommen. Das betrifft Palantir nicht: Ausgeliefert werden sie als Teil
der Anwendung, nicht als Ware.

## Eine Schrift ergänzen

Zwei Handgriffe, in dieser Reihenfolge:

1. Datei als `<slug>.woff2` hier ablegen, Lizenztext nach `lizenzen/`, Zeile in
   die Tabelle oben.
2. Eintrag in `apps/backend/src/modules/fonts/bundled.ts`.

Ein Eintrag ohne Datei erscheint nicht in der Liste und ist nicht wählbar – die
Reihenfolge ist also unkritisch, nur beides zusammen wirkt.

**Keine Fassungsnummer im Dateinamen.** Die Kennung steht in den
Instanz-Einstellungen und muss einen Austausch der Datei überleben; eine Kennung
mit Fassung wäre nach der ersten Aktualisierung ungültig, und die Instanz fiele
stillschweigend auf die Vorgabe zurück.

## Eine Schrift, die hier nicht liegen darf

Nicht jede Schrift lässt sich mitliefern. Zwei Fälle, die bei der Auswahl
aufkamen:

- **911 Porscha** (Iconian Fonts) ist ausdrücklich nur für den privaten Gebrauch
  freigegeben. Eine Instanz, die andere Menschen bedient, ist kein privater
  Gebrauch.
- **Schriften für Tengwar oder Sindarin** aus dem Umfeld von _Der Herr der
  Ringe_ tragen uneinheitliche Lizenzen, und die Namen der Werke stehen unter
  Markenschutz. Dazu kommt ein praktischer Einwand: Eine Tengwar-Schrift bildet
  lateinische Buchstaben auf elbische Zeichen ab – die Oberfläche wäre
  buchstäblich nicht mehr lesbar.

Beides ist kein Verlust: Wer eine solche Schrift auf **seiner eigenen** Instanz
benutzen will, lädt sie in der Schriftverwaltung hoch. Genau dafür gibt es den
Upload. Was der Betreiber für seine Instanz lizenziert, entscheidet er selbst;
was Palantir an alle ausliefert, muss dafür lizenziert sein.
