/**
 * Reihenfolge von Ständen, die aus zwei Quellen kommen (Fundpunkt event-flow-04).
 *
 * Derselbe Server-Status erreicht den Browser auf zwei Wegen: über den
 * Live-Kanal und als Antwort eines REST-Aufrufs. Wer von beiden recht hat,
 * entscheidet nicht die Quelle, sondern das Alter – und genau das war bisher
 * nirgends festgehalten: Ein alter Live-Stand gewann überall gegen eine gerade
 * eingetroffene REST-Antwort (`live ?? dto`).
 *
 * **Warum eine Sequenz und kein Zeitstempel.** Die Ereignis-Frames tragen zwar
 * `sentAt`, das ist aber die Uhr des Backends; der `GameServerDto` trägt gar
 * keinen Zeitpunkt seines Status. Ein Vergleich müsste also entweder zwei
 * verschiedene Uhren gegeneinanderstellen oder auf `Date.now()` ausweichen,
 * dessen Auflösung von einer Millisekunde bei zwei schnell aufeinander
 * folgenden Ständen zum Gleichstand führt. Der Zähler hier misst stattdessen
 * genau das, worauf es ankommt: **in welcher Reihenfolge dieser Browser die
 * Stände erfahren hat.**
 */

let letzteNummer = 0;

/**
 * Nächste Nummer der Reihe – streng monoton wachsend, gilt für die ganze Seite.
 *
 * `0` bleibt bewusst frei und bedeutet „so alt wie der Seitenaufbau"; jeder
 * danach erfahrene Stand hat eine Nummer größer als `0`.
 */
export function nextRevision(): number {
  letzteNummer += 1;

  return letzteNummer;
}
