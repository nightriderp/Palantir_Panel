/**
 * Fügt Klassennamen zusammen und wirft falsy Werte weg.
 *
 * Bewusst ohne `clsx`/`tailwind-merge` – das Design-System kommt für diesen
 * kleinen Zweck ohne zusätzliche Abhängigkeit aus (CLAUDE.md §1).
 *
 * Hinweis: es findet **keine** Konfliktauflösung zwischen Tailwind-Klassen statt.
 * Wer eine Token-Klasse einer Komponente überschreiben will, sollte die dafür
 * vorgesehene Prop (z. B. `variant`) nutzen statt eine konkurrierende Klasse
 * über `className` nachzuschieben.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
