/**
 * Zod-Schemas für die Client-Frames des Server-Live-Kanals (`/live`,
 * Pflichtenheft §5.3).
 *
 * Gegenstück zu `LiveClientFrame` und `LiveTopic` aus `@palantir/contracts`.
 * Der Kanal verbindet Browser und Backend (nicht zu verwechseln mit dem
 * Agent-Protokoll); geprüft werden ausschließlich die Frames, die der **Browser
 * schickt** – die Gegenrichtung erzeugt das Backend selbst.
 *
 * Warum das hier steht (Audit-Fundstelle contracts-validation-04): Die
 * REST-Konsolenroute prüft jeden Befehl gegen `consoleCommandSchema` (höchstens
 * 512 Zeichen, keine Zeilenumbrüche). Der WebSocket-Weg parste seine Frames von
 * Hand und verlangte nur „nicht leer" – derselbe Vorgang mit zwei Regelsätzen,
 * genau das Anti-Ziel aus `servers.ts` und `chat.ts`. Für den Inbox-Kanal gibt
 * es das Gegenstück längst (`notificationClientFrameSchema`); hier fehlte es.
 */

import { type LiveClientFrame, type LiveTopic } from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';
import { consoleCommandSchema } from './servers.js';

/**
 * Thema, auf das ein Browser sich abonniert.
 *
 * `resource` ist bewusst als Literal geführt und nicht als offener String:
 * ein einzelner Gameserver oder – seit Fundpunkt 173 – die Serverliste des
 * Aufrufers, deren `id` fest `all` ist. Eine weitere Ressource käme additiv
 * als weiteres Literal dazu.
 */
export const liveTopicSchema: z.ZodType<LiveTopic> = z.discriminatedUnion('resource', [
  z.object({ resource: z.literal('server'), id: idSchema }),
  z.object({ resource: z.literal('serverList'), id: z.literal('all') }),
]);

/**
 * Frames, die der Browser über den Live-Kanal schickt.
 *
 * `consoleCommand` nutzt `consoleCommandSchema` – dieselbe Regel wie der
 * REST-Pfad, damit ein mehrzeiliger oder mehrere Megabyte großer „Befehl" nicht
 * über den Kanal daneben bis in `EXEC_CONSOLE` durchläuft.
 *
 * `ping` trägt als einziges Frame **kein** Thema: Das Lebenszeichen gilt der
 * Verbindung, nicht einem Abo (Audit W2-5). Bis der Vertrag es kannte, fing die
 * Route es vor dem Schema von Hand ab – ein zweiter Parser für denselben Kanal,
 * genau das Anti-Ziel dieser Datei.
 *
 * Die Typ-Annotation ist Absicht: kommt in `@palantir/contracts` ein Frame dazu
 * oder ändert sich einer, schlägt hier die Übersetzung fehl, statt dass Schema
 * und Vertrag still auseinanderlaufen.
 */
export const liveClientFrameSchema: z.ZodType<LiveClientFrame> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('subscribe'), topic: liveTopicSchema }),
  z.object({ kind: z.literal('unsubscribe'), topic: liveTopicSchema }),
  z.object({
    kind: z.literal('consoleCommand'),
    topic: liveTopicSchema,
    command: consoleCommandSchema,
  }),
  z.object({ kind: z.literal('ping') }),
]);

export type LiveTopicInput = z.infer<typeof liveTopicSchema>;
export type LiveClientFrameInput = z.infer<typeof liveClientFrameSchema>;
