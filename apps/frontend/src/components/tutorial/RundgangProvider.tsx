'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { RUNDGANG_STORAGE_KEY, parseStand, serializeStand } from './rundgangStand';

/**
 * Wer den Rundgang startet, beendet und wieder einschaltet.
 *
 * Der Stand liegt im `localStorage` und wird wie die Anzeige-Vorlieben der
 * Benachrichtigungen als **externe Quelle** angebunden
 * (`useSyncExternalStore`, siehe `notifications/usePreferences.ts`): Auf dem
 * Server und beim Hydratisieren gilt „noch nicht gelesen", im Browser der
 * gespeicherte Wert. Kein Effekt zieht etwas nach, und es gibt kein Bild, in
 * dem der Rundgang kurz aufblitzt, weil der Speicher noch nicht gelesen war.
 *
 * **Von selbst startet er nur einmal**, und nur wenn drei Dinge zusammenkommen:
 * der Speicher ist gelesen, er steht auf „offen", und das Konto ist da. Das
 * Konto muss sein, weil die Seitenleiste ihre Einträge aus dessen
 * Berechtigungen baut – ohne sie stünde der Scheinwerfer auf leeren Stellen.
 */

export interface RundgangApi {
  /** Läuft der Rundgang in diesem Moment? */
  laeuft: boolean;
  /** Hat dieser Browser ihn schon hinter sich? */
  erledigt: boolean;
  /** Erst nach dem ersten Rendern `true` – bis dahin gilt „noch nicht gelesen". */
  bereit: boolean;
  starten: () => void;
  beenden: () => void;
  /** Beim nächsten Besuch wieder von selbst zeigen (oder eben nicht). */
  wiederZeigen: (an: boolean) => void;
}

const RundgangContext = createContext<RundgangApi | null>(null);

function keinAbo(): () => void {
  return () => {};
}

/** Roher Eintrag; `null`, wenn keiner da ist oder der Speicher gesperrt ist. */
function ausSpeicher(): string | null {
  try {
    return window.localStorage.getItem(RUNDGANG_STORAGE_KEY);
  } catch {
    // Privates Fenster, gesperrter Speicher: dann eben jedes Mal von vorn.
    return null;
  }
}

/** `undefined` unterscheidet „noch nicht gelesen" von „nichts gespeichert". */
function aufDemServer(): undefined {
  return undefined;
}

export interface RundgangProviderProps {
  /**
   * Ist das Konto geladen? Erst dann darf der Rundgang von selbst anfangen –
   * vorher ist die Seitenleiste leer und jede Station hätte kein Ziel.
   */
  kontoGeladen: boolean;
  children: ReactNode;
}

export function RundgangProvider({ kontoGeladen, children }: RundgangProviderProps) {
  const gespeichert = useSyncExternalStore(keinAbo, ausSpeicher, aufDemServer);
  const bereit = gespeichert !== undefined;

  /** In dieser Sitzung gesetzt – gilt vor dem Speicher, auch wenn der klemmt. */
  const [gesetzt, setGesetzt] = useState<'offen' | 'erledigt' | null>(null);

  /** `null` = noch keine Entscheidung in dieser Sitzung getroffen. */
  const [handbetrieb, setHandbetrieb] = useState<'an' | 'aus' | null>(null);

  const stand = gesetzt ?? (gespeichert === undefined ? 'offen' : parseStand(gespeichert));

  const merken = useCallback((wert: 'offen' | 'erledigt') => {
    setGesetzt(wert);
    try {
      window.localStorage.setItem(RUNDGANG_STORAGE_KEY, serializeStand(wert));
    } catch {
      // Ohne Speicher gilt die Entscheidung nur für diese Sitzung.
    }
  }, []);

  const api = useMemo<RundgangApi>(() => {
    const vonSelbst = bereit && kontoGeladen && stand === 'offen';

    return {
      laeuft: handbetrieb === 'an' || (handbetrieb === null && vonSelbst),
      erledigt: stand === 'erledigt',
      bereit,
      starten: () => setHandbetrieb('an'),
      beenden: () => {
        setHandbetrieb('aus');
        merken('erledigt');
      },
      // Der Schalter in den Einstellungen stellt nur den Stand um; losgehen
      // soll der Rundgang deswegen nicht sofort – man sitzt ja gerade in den
      // Einstellungen. Dafür gibt es den Knopf daneben.
      wiederZeigen: (an: boolean) => {
        setHandbetrieb('aus');
        merken(an ? 'offen' : 'erledigt');
      },
    };
  }, [bereit, kontoGeladen, stand, handbetrieb, merken]);

  return <RundgangContext.Provider value={api}>{children}</RundgangContext.Provider>;
}

/**
 * Zugriff auf den Rundgang.
 *
 * Ohne Anbieter darüber ein stiller Blindgänger statt eines Fehlers: Die
 * Einstellungen liegen zwar immer unter dem Rahmen des eingeloggten Bereichs,
 * aber ein Baustein, der eine ganze Ansicht sprengt, weil ein Scherz nicht
 * eingehängt ist, wäre die falsche Gewichtung.
 */
const OHNE_RUNDGANG: RundgangApi = {
  laeuft: false,
  erledigt: true,
  bereit: false,
  starten: () => {},
  beenden: () => {},
  wiederZeigen: () => {},
};

export function useRundgang(): RundgangApi {
  return useContext(RundgangContext) ?? OHNE_RUNDGANG;
}
