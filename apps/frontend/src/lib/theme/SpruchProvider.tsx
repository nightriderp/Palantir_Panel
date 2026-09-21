'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { STANDARD_THEME_ID } from './palette';
import { spruch, type Spruch, type SpruchSlot } from './sprueche';

/**
 * Reicht das gewählte Theme an die Stellen durch, die einen eigenen Text
 * bekommen dürfen (`lib/theme/sprueche.ts`).
 *
 * **Warum ein Kontext und nicht das Dokument.** Das Attribut `data-theme` steht
 * am `<html>`-Element und wäre auszulesen – aber erst im Browser. Beim Rendern
 * auf dem Server gibt es kein Dokument; die erste Ausgabe trüge den neutralen
 * Text, die Hydrierung tauschte ihn aus, und React meldete zu Recht einen
 * Unterschied. Für Farben ist das kein Thema, die löst der Browser über CSS
 * auf. Text muss dagegen schon beim Rendern feststehen.
 *
 * Der Anbieter steht deshalb im Wurzel-Layout, das die Wahl ohnehin aus dem
 * Cookie liest – **eine** Quelle für Attribut und Text, kein zweiter Weg, der
 * auseinanderlaufen könnte.
 *
 * ⚠️ Server-Komponenten erreicht der Kontext nicht; sie haben keine Hooks. Die
 * 404-Seite liest die Wahl deshalb selbst aus dem Cookie (`app/not-found.tsx`).
 * Das ist kein Umweg, sondern derselbe Weg: Das Cookie ist die Quelle, der
 * Kontext nur die Verteilung für den Client-Teil.
 */
const SpruchContext = createContext<string>(STANDARD_THEME_ID);

export function SpruchProvider({ themeId, children }: { themeId: string; children: ReactNode }) {
  return <SpruchContext.Provider value={themeId}>{children}</SpruchContext.Provider>;
}

/**
 * Der Text einer Stelle im gerade gewählten Theme.
 *
 * Ohne Anbieter darüber kommt der neutrale Text – der Vorgabewert des
 * Kontexts ist der Standard. Eine Komponente kann also nicht dadurch kaputt
 * gehen, dass sie außerhalb des Rahmens gerendert wird (Tests, Fehlerseiten).
 */
export function useSpruch(slot: SpruchSlot): Spruch {
  return spruch(useContext(SpruchContext), slot);
}
