import { type AccountDto } from '@palantir/contracts';
import { type IconName } from '@/components/shared';

/**
 * Inhalt der Einweisung: was die Bereiche tun – und was das Tutorial dazu sagt.
 *
 * Jeder Schritt hat **beides**: eine `erklaerung`, die stimmt und die man
 * jemandem zeigen könnte, der das Panel zum ersten Mal öffnet, und eine
 * `spitze`, die ihn dafür aufzieht. Ohne den ersten Teil wäre es kein Tutorial,
 * ohne den zweiten läse es niemand zu Ende.
 *
 * **Die Reihenfolge folgt der Seitenleiste** (`DashboardNav.tsx`). Wer dort
 * etwas umsortiert, sortiert hier mit – sonst führt die Einweisung durch ein
 * Panel, das es so nicht gibt.
 *
 * **Berechtigungen wie überall:** `requires` nennt ein Flag aus
 * `AccountDto.permissions` (Pflichtenheft §5.2, §8). Wer keine Nodes sehen
 * darf, bekommt den Node-Schritt nicht erklärt und auch nicht mitgezählt – nie
 * aus einer Rolle hergeleitet.
 */
export interface TutorialSchritt {
  key: string;
  titel: string;
  icon: IconName;
  /** Der ernst gemeinte Teil: was der Bereich wirklich kann. */
  erklaerung: string;
  /** Der unernste Teil zum selben Bereich. */
  spitze: string;
  /** Ziel im Panel – am Ende jedes Schritts als „Zeig mir das". */
  href: string;
  /** Nur zeigen, wenn dieses Flag am Konto gesetzt ist. */
  requires?: keyof AccountDto['permissions'];
}

export const TUTORIAL_SCHRITTE: readonly TutorialSchritt[] = [
  {
    key: 'uebersicht',
    titel: 'Übersicht',
    icon: 'grid',
    href: '/servers',
    erklaerung:
      'Jeder Server ist eine Karte: Zustand, CPU, RAM, Platte und Ping als Ringe, darunter die Adresse zum Kopieren. Starten, Stoppen und Neustarten liegen direkt auf der Karte. Angeheftete Server stehen oben – das gilt auf jedem Gerät, nicht nur in diesem Browser.',
    spitze:
      'Die Ringe färben sich nach Auslastung: grün, gelb, rot. Nein, sie werden nicht grüner, wenn du sie anstarrst. Wir haben das für dich getestet.',
  },
  {
    key: 'server-neu',
    titel: 'Server erstellen',
    icon: 'plus',
    href: '/servers/neu',
    requires: 'canCreateServer',
    erklaerung:
      'Spiel wählen, Namen vergeben, RAM, CPU und Plattenplatz einstellen, fertig. Wie viel du noch vergeben darfst, steht als Kontingent daneben; reicht es nicht, stellst du eine Anfrage an einen Admin statt auf „mehr" zu klicken und zu hoffen.',
    spitze:
      'Du wirst gleich 16 GB RAM einstellen für einen Server, auf dem ihr zu dritt Häuser baut. Machen alle. Wir sagen nichts mehr dazu.',
  },
  {
    key: 'my-backups',
    titel: 'Meine Backups',
    icon: 'database',
    href: '/my-backups',
    erklaerung:
      'Sicherungen deiner Server: anlegen, herunterladen, wiederherstellen. Automatisch erzeugte stehen in derselben Liste. Eine Wiederherstellung überschreibt den laufenden Stand – deshalb fragt das Panel vorher nach.',
    spitze:
      'Das ist die Funktion, die niemand anschaut. Bis 22:47 Uhr an einem Freitag. Dann ist sie plötzlich die wichtigste Seite des ganzen Projekts.',
  },
  {
    key: 'skins',
    titel: 'Skins',
    icon: 'palette',
    href: '/skins',
    erklaerung:
      'Hier kommen Skins hin, sobald das erste Spiel vollständig unterstützt wird. Aktuell steht dort ein ehrlicher Hinweis, dass es den Bereich noch nicht gibt – Phase 2.',
    spitze:
      'Du hast trotzdem draufgeklickt. Zweimal. Wir haben kein Zählwerk dafür, aber wir wissen es.',
  },
  {
    key: 'messages',
    titel: 'Nachrichten',
    icon: 'chat',
    href: '/messages',
    erklaerung:
      'Der Chat des Panels, samt Stickern und Ungelesen-Zähler in der Seitenleiste. Gedacht für „Server läuft" und „wer hat den Ofen angelassen", nicht für die Verhandlung von Friedensverträgen.',
    spitze:
      'Es gibt eine Moderation. Sie wird von Menschen bedient, die deine Nachrichten lesen können. Denk einmal kurz daran, bevor du den Sticker schickst.',
  },
  {
    key: 'notifications',
    titel: 'Benachrichtigungen',
    icon: 'bell',
    href: '/notifications',
    erklaerung:
      'Posteingang für Ereignisse: Server gestartet, Backup fertig, Anfrage beantwortet. Was dich erreicht und was nicht, stellst du selbst ein – einzelne Ereignisarten lassen sich stummschalten.',
    spitze:
      'Du kannst alles stummschalten. Wirklich alles. Und dann fragen, warum dir niemand gesagt hat, dass der Server aus ist.',
  },
  {
    key: 'arcade',
    titel: 'Arcade',
    icon: 'gamepad',
    href: '/arcade',
    erklaerung:
      'Fünf selbst gebaute Minispiele mit Bestenliste je Spiel. Am Rechner mit Pfeiltasten und Leertaste, am Telefon über die Tasten unter dem Feld. Dein bestes Ergebnis landet in der Liste.',
    spitze:
      'Der einzige Bereich, in dem du dich messbar blamieren kannst. Die Bestenliste vergisst nichts und zeigt deinen Namen sehr deutlich an.',
  },
  {
    key: 'profil',
    titel: 'Profil & Einstellungen',
    icon: 'user',
    href: '/profil',
    erklaerung:
      'Anzeigename, Profilbild, Passwort und die Zwei-Faktor-Anmeldung. Der zweite Faktor ist der einzige Punkt dieser Einweisung, bei dem wir wirklich bitten: Schalt ihn ein.',
    spitze:
      'Dein Passwort ist übrigens nicht „passwort1". Sagst du. Wir glauben dir. Irgendwie müssen wir ja weiterleben.',
  },
  {
    key: 'nodes',
    titel: 'Nodes',
    icon: 'server',
    href: '/nodes',
    requires: 'canViewNodes',
    erklaerung:
      'Die Maschinen hinter den Servern: Verbindungszustand, Auslastung, freier Platz. Der Homeserver verbindet sich von sich aus zur VPS – deshalb steht hier nie eine Portfreigabe.',
    spitze:
      'Ist eine Node offline, ist auch dein Server offline. Das Panel ist gut, aber es kann keinen Stecker wieder reinstecken.',
  },
  {
    key: 'admin',
    titel: 'Administration',
    icon: 'shield',
    href: '/admin',
    requires: 'canManageUsers',
    erklaerung:
      'Nutzer, Rollen, Anfragen, Moderation und das Audit-Log. Rechte werden über Rollen vergeben; das Audit-Log hält fest, wer was getan hat.',
    spitze:
      'Das Audit-Log vergisst nichts. Falls du also gerade überlegst, „nur mal kurz" etwas auszuprobieren: Es steht danach da. Mit Uhrzeit.',
  },
] as const;

/** Die Schritte, die dieses Konto überhaupt zu sehen bekommt. */
export function sichtbareSchritte(user: AccountDto | null): TutorialSchritt[] {
  return TUTORIAL_SCHRITTE.filter(
    (schritt) => !schritt.requires || (user?.permissions[schritt.requires] ?? false),
  );
}

export interface QuizAntwort {
  text: string;
  richtig: boolean;
  /** Die Rückmeldung zu genau dieser Antwort. */
  echo: string;
}

export interface QuizFrage {
  key: string;
  frage: string;
  antworten: readonly QuizAntwort[];
}

/**
 * Das Abschlussquiz – drei Fragen, die tatsächlich etwas abfragen.
 *
 * Die falschen Antworten sind die, die im Freundeskreis wirklich vorkommen;
 * die richtige ist jedes Mal die langweilige. Genau darum geht es.
 *
 * ⚠️ **Die richtige Antwort steht nicht immer an derselben Stelle.** Sie stand
 * dreimal oben – wer das merkt, klickt dreimal die erste und hat ein volles
 * Zeugnis, ohne eine Frage gelesen zu haben. Wer eine Frage ergänzt, mischt
 * sie bitte ebenfalls dazwischen.
 */
export const QUIZ_FRAGEN: readonly QuizFrage[] = [
  {
    key: 'offline',
    frage: 'Dein Server ist offline. Was tust du zuerst?',
    antworten: [
      {
        text: 'Auf „Starten" drücken.',
        richtig: true,
        echo: 'Richtig. Erschreckend einfach, nicht wahr?',
      },
      {
        text: 'In die Gruppe schreiben, dass das Panel kaputt ist.',
        richtig: false,
        echo: 'Der Klassiker. Der Knopf war die ganze Zeit da, grün, mit Beschriftung.',
      },
      {
        text: 'Vorsichtshalber einen zweiten Server anlegen.',
        richtig: false,
        echo: 'Mutig. Dein Kontingent weint leise in der Ecke.',
      },
    ],
  },
  {
    key: 'backups',
    frage: 'Wofür ist „Meine Backups" da?',
    antworten: [
      {
        text: 'Zum Anschauen. Benutzt werden sie nie.',
        richtig: false,
        echo: 'Das ist keine Antwort, das ist ein Geständnis.',
      },
      {
        text: 'Für den Moment, in dem jemand etwas sprengt.',
        richtig: false,
        echo: 'Inhaltlich nicht falsch. Aber es gibt eine Antwort, die so im Handbuch steht.',
      },
      {
        text: 'Sicherungen anlegen, herunterladen und wiederherstellen.',
        richtig: true,
        echo: 'Richtig. Und jetzt leg bitte wirklich eine an.',
      },
    ],
  },
  {
    key: 'rechte',
    frage: 'Wer entscheidet, welche Knöpfe du im Panel überhaupt siehst?',
    antworten: [
      {
        text: 'Der Zufall.',
        richtig: false,
        echo: 'Bei mancher anderen Software: ja. Hier nicht.',
      },
      {
        text: 'Deine Berechtigungen.',
        richtig: true,
        echo: 'Richtig. Das Panel zeigt genau das, wofür dein Konto ein Recht hat.',
      },
      {
        text: 'Der Admin, wenn er gute Laune hat.',
        richtig: false,
        echo: 'Der Admin vergibt die Rolle. Die gute Laune ist optional und selten.',
      },
    ],
  },
] as const;

/** Punkte aus den gegebenen Antworten – `null` für noch nicht beantwortet. */
export function quizPunkte(antworten: readonly (number | null)[]): number {
  return antworten.reduce<number>((summe, gewaehlt, index) => {
    const frage = QUIZ_FRAGEN[index];
    if (!frage || gewaehlt === null) return summe;

    return frage.antworten[gewaehlt]?.richtig ? summe + 1 : summe;
  }, 0);
}
