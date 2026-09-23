/**
 * Status-Kachel im Server-Kanal (F3, Pflichtenheft §14a.5).
 *
 * Reine Darstellung: aus einem Schnappschuss des Servers wird ein Embed. Die
 * Laufzeit steht als Discord-Zeitstempel (`<t:…:R>`) darin – den rechnet der
 * Client selbst fort. Die Kachel muss deshalb nicht jede Minute bearbeitet
 * werden, nur wenn sich wirklich etwas ändert (Zustand, Spielerzahl, Adresse).
 * Ob das so ist, sagt {@link tileHash}.
 *
 * Knöpfe folgen in DC-3; bis dahin trägt die Kachel keine.
 */

import { createHash } from 'node:crypto';
import type { ServerStatus } from '@palantir/contracts';
import { escapeMarkdown } from './interactions.js';

export interface TileSnapshot {
  readonly name: string;
  readonly gameTypeName: string;
  readonly status: ServerStatus;
  /** Anzeigefertige Verbindungsadresse, z. B. `mc.example.de` oder `example.de:27015`. */
  readonly address: string | null;
  readonly players: { readonly online: number; readonly max: number | null } | null;
  /** Seit wann der Server läuft (nur bei `running` sinnvoll). */
  readonly runningSince: Date | null;
  /** Direktverweis auf den Server im Panel. */
  readonly panelUrl: string;
}

export interface TileEmbed {
  readonly title: string;
  readonly url: string;
  readonly color: number;
  readonly fields: readonly { name: string; value: string; inline: boolean }[];
  readonly footer: { text: string };
}

export interface TileMessage {
  readonly embeds: readonly TileEmbed[];
  readonly allowed_mentions: { readonly parse: readonly string[] };
}

const STATUS: Record<ServerStatus, { label: string; color: number }> = {
  creating: { label: 'Wird angelegt', color: 0x6b7280 },
  stopped: { label: 'Gestoppt', color: 0x6b7280 },
  starting: { label: 'Startet …', color: 0xf59e0b },
  running: { label: 'Läuft', color: 0x22c55e },
  stopping: { label: 'Stoppt …', color: 0xf59e0b },
  error: { label: 'Fehler', color: 0xef4444 },
  crashed: { label: 'Abgestürzt', color: 0xef4444 },
};

export function renderTile(snapshot: TileSnapshot): TileMessage {
  const status = STATUS[snapshot.status];
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: 'Status', value: status.label, inline: true },
    { name: 'Spiel', value: escapeMarkdown(snapshot.gameTypeName), inline: true },
  ];

  if (snapshot.players) {
    const max = snapshot.players.max === null ? '' : ` / ${String(snapshot.players.max)}`;
    fields.push({
      name: 'Spieler',
      value: `${String(snapshot.players.online)}${max}`,
      inline: true,
    });
  }

  if (snapshot.address) {
    // Im Codeblock: kopierbar und ohne Markdown-Deutung.
    fields.push({ name: 'Adresse', value: `\`${snapshot.address}\``, inline: false });
  }

  if (snapshot.status === 'running' && snapshot.runningSince) {
    const seit = Math.floor(snapshot.runningSince.getTime() / 1000);
    fields.push({ name: 'Läuft seit', value: `<t:${String(seit)}:R>`, inline: true });
  }

  return {
    embeds: [
      {
        title: snapshot.name.slice(0, 256),
        url: snapshot.panelUrl,
        color: status.color,
        fields,
        footer: { text: 'Palantir' },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/** Fingerabdruck des Inhalts – gleich bleibt gleich, also keine Bearbeitung. */
export function tileHash(message: TileMessage): string {
  return createHash('sha256').update(JSON.stringify(message)).digest('hex');
}
