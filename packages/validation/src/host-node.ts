/**
 * Zod-Schemas zur Node-Verwaltung (Lastenheft §3.7, Pflichtenheft §6).
 *
 * Gegenstück zu `HostNodeDto` aus `@palantir/contracts`. Backend
 * (Request-Validierung) und Frontend (Node-Formular in F10) nutzen dieselben
 * Regeln – kein zweiter, abweichender Regelsatz.
 *
 * `nodeResourcesSchema` stammt aus `resources.ts` (B4) und wird hier nur
 * wiederverwendet: Die Ressourcenmenge einer Node ist dieselbe, egal ob sie
 * geprüft oder verwaltet wird (CLAUDE.md §3).
 */

import { HOST_NODE_STATUSES } from '@palantir/contracts';
import { z } from 'zod';
import { nodeResourcesSchema } from './resources.js';

export const hostNodeStatusSchema = z.enum(HOST_NODE_STATUSES);

export const hostNodeNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Der Node-Name muss mindestens 2 Zeichen lang sein.' })
  .max(50, { message: 'Der Node-Name darf höchstens 50 Zeichen lang sein.' });

/**
 * Feste interne Adresse im WireGuard-Netz (Pflichtenheft §2.1, z. B. `10.10.0.2`).
 *
 * Bewusst nur IPv4: Der Tunnel wird im Setup mit festen IPv4-Adressen
 * eingerichtet (SETUP.md), eine IPv6-Variante gibt es dort nicht.
 */
export const wireguardIpSchema = z
  .string()
  .trim()
  .ip({ version: 'v4', message: 'Erwartet wird eine IPv4-Adresse aus dem Tunnel-Netz.' });

/** Eingabe zum Anlegen einer Node (F10 → Backend). */
export const createHostNodeInputSchema = z.object({
  name: hostNodeNameSchema,
  wireguardIp: wireguardIpSchema,
  totalResources: nodeResourcesSchema,
});

/**
 * Eingabe zum Bearbeiten einer Node – alle Felder optional (Teil-Update).
 *
 * Der Zustand einer Node wird **nie** von Hand gesetzt: Ob sie `online` oder
 * `offline` ist, entscheidet allein die Agent-Verbindung. Von Hand steuerbar
 * ist deshalb nur die Wartung, und zwar als Ja/Nein statt als Zustand:
 * `maintenance: true` legt die Node still, `maintenance: false` gibt sie an die
 * automatische Führung zurück, die dann den wirklichen Zustand einträgt.
 *
 * Das Schema ist bewusst `strict()`: Ein mitgeschicktes `status` soll auffallen
 * und abgelehnt werden. Ohne `strict()` würde Zod das Feld still entfernen, und
 * der Aufrufer bekäme eine Erfolgsmeldung für etwas, das nicht geschehen ist.
 */
export const updateHostNodeInputSchema = z
  .object({
    name: hostNodeNameSchema,
    wireguardIp: wireguardIpSchema,
    totalResources: nodeResourcesSchema,
    maintenance: z.boolean(),
    statusMessage: z.string().trim().max(200).nullable(),
  })
  .partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Es muss mindestens ein Feld geändert werden.',
  });

export type CreateHostNodeInput = z.infer<typeof createHostNodeInputSchema>;
export type UpdateHostNodeInput = z.infer<typeof updateHostNodeInputSchema>;
