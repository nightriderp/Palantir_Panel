import { type ServerAddress } from '@palantir/contracts';

/**
 * Anzeige-Formatierungen des Design-Systems.
 *
 * Alles hier ist reine Funktion ohne React – deshalb direkt testbar
 * (siehe `format.test.ts`). Oberflächensprache ist Deutsch (Lastenheft §4),
 * Zahlen werden entsprechend mit `de-DE` formatiert.
 */

const NUMBER_FORMAT = new Intl.NumberFormat('de-DE');

/** Ganze Zahl mit deutschem Tausenderpunkt, z. B. `1.024`. */
export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/**
 * Speichergröße aus Megabyte in eine lesbare Angabe.
 *
 * Basis 1024, wie überall sonst im Projekt bei Container-Limits.
 */
export function formatMegabytes(valueMb: number | null | undefined): string {
  if (valueMb == null || Number.isNaN(valueMb)) return '—';
  if (valueMb < 1024) return `${NUMBER_FORMAT.format(Math.round(valueMb))} MB`;
  const gb = valueMb / 1024;
  if (gb < 1024) {
    return `${NUMBER_FORMAT.format(Math.round(gb * 10) / 10)} GB`;
  }
  return `${NUMBER_FORMAT.format(Math.round((gb / 1024) * 100) / 100)} TB`;
}

/** Prozentwert, auf ganze Prozent gerundet und auf 0–100 begrenzt. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${clampPercent(value)} %`;
}

/** Begrenzt einen Wert auf den Bereich 0–100 und rundet ihn auf ganze Zahlen. */
export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Spieleranzahl als `3 / 20`; `—`, solange keine Zahlen vorliegen. */
export function formatPlayers(
  online: number | null | undefined,
  max: number | null | undefined,
): string {
  if (online == null) return '—';
  if (max == null) return NUMBER_FORMAT.format(online);
  return `${NUMBER_FORMAT.format(online)} / ${NUMBER_FORMAT.format(max)}`;
}

/** Latenz in Millisekunden, z. B. `24 ms`. */
export function formatPing(pingMs: number | null | undefined): string {
  if (pingMs == null) return '—';
  return `${NUMBER_FORMAT.format(Math.round(pingMs))} ms`;
}

/**
 * Verbindungsadresse als eine Zeile.
 *
 * Ohne Port (Hostname-Routing, initial Minecraft – Pflichtenheft §13) wird nur
 * der Hostname ausgegeben.
 */
export function formatServerAddress(address: ServerAddress | null | undefined): string | null {
  if (!address) return null;
  return address.port == null ? address.hostname : `${address.hostname}:${address.port}`;
}

/**
 * Kürzel für die Server-Kachel: die ersten beiden Buchstaben/Ziffern des Namens.
 *
 * Fällt auf `??` zurück, wenn der Name keine verwertbaren Zeichen enthält.
 */
export function serverInitials(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}]/gu, '');
  if (cleaned.length === 0) return '??';
  return cleaned.slice(0, 2).toUpperCase();
}
