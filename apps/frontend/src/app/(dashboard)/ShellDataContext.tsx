'use client';

import { createContext, useContext } from 'react';
import { type GameServerDto } from '@palantir/contracts';

/**
 * Was der Rahmen ohnehin schon geholt hat und die Seite darunter mitbenutzen
 * darf.
 *
 * **Bewusst kein Zustandsspeicher.** Der Rahmen bleibt die einzige Stelle, die
 * diese Liste lädt und fortschreibt; die Seiten darunter *lesen* sie nur – und
 * zwar als Anfangsbestand, bis ihr eigener Abruf zurück ist. Ein gemeinsamer
 * Speicher, in den auch geschrieben wird, wäre der nächste Schritt und ein
 * deutlich größerer: Jede Ansicht braucht ihre Liste mit anderen Filtern und
 * anderer Frische, und der Rahmen darf davon nicht abhängen.
 *
 * Der Anlass: `DashboardShell` hält die Serverliste für Kopf- und
 * Seitenleiste, und `/servers` holte dieselbe Liste noch einmal – mit einem
 * „Server werden geladen …" davor, obwohl die Karten längst hätten stehen
 * können. Auf der VPS sind das je Seitenwechsel ein paar hundert Millisekunden
 * Leere, in denen die Anwendung Daten anzeigen könnte, die sie schon hat.
 */
export interface ShellData {
  /**
   * Serverliste des Rahmens – `null`, solange sein eigener Abruf läuft.
   *
   * Die rohen DTOs, **nicht** der mit dem Live-Kanal zusammengeführte Stand:
   * Jede Ansicht führt selbst zusammen (`mergeLiveStatus`), und ein zweimal
   * zusammengeführter Stand wäre schwerer zu begründen als ein einmal
   * geholter.
   */
  servers: GameServerDto[] | null;
}

const ShellDataContext = createContext<ShellData>({ servers: null });

export const ShellDataProvider = ShellDataContext.Provider;

/**
 * Anfangsbestand aus dem Rahmen.
 *
 * Gibt außerhalb des Dashboards (Anmeldung, Fehlerseiten) `null` zurück statt
 * zu werfen – eine Ansicht, die ohne Rahmen läuft, soll deshalb nicht
 * scheitern, sie lädt dann eben selbst.
 */
export function useShellServers(): GameServerDto[] | null {
  return useContext(ShellDataContext).servers;
}
