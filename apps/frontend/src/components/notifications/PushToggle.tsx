'use client';

import { useCallback, useEffect, useState } from 'react';
import { ToggleRow, useToast } from '@/components/shared';
import {
  type PushZustand,
  ladePushConfig,
  pushAbmelden,
  pushAnmelden,
  pushZustand,
} from '@/lib/live/push';

/**
 * Schalter für Web-Push (Meldungen aufs Gerät, auch bei geschlossenem Panel).
 *
 * **Abgrenzung zum Schalter darüber.** „Mitteilungen des Browsers"
 * (`DesktopToggle`) zeigt eine Meldung, solange das Panel offen ist – das ist
 * eine Einstellung dieses Kontos und gilt überall. Push dagegen gehört dem
 * **Gerät**: Jeder Browser meldet sich einzeln an, und abgemeldet wird auch
 * einzeln. Deshalb steht hier kein Konto-Schalter, sondern der Zustand dieses
 * einen Browsers.
 *
 * Ist für die Instanz kein Schlüsselpaar hinterlegt, erscheint der Schalter
 * gar nicht: Ein Schalter, der nie etwas bewirkt, ist schlimmer als keiner.
 */
export function PushToggle() {
  const toast = useToast();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [zustand, setZustand] = useState<PushZustand>('nicht-moeglich');
  const [busy, setBusy] = useState(false);

  const aktualisieren = useCallback(async (key: string | null) => {
    setZustand(await pushZustand(key));
  }, []);

  useEffect(() => {
    const abbruch = new AbortController();

    void (async () => {
      const key = await ladePushConfig(abbruch.signal);
      if (abbruch.signal.aborted) return;

      setPublicKey(key);
      await aktualisieren(key);
    })();

    return () => abbruch.abort();
  }, [aktualisieren]);

  async function umschalten(an: boolean) {
    if (publicKey === null) return;

    setBusy(true);
    try {
      if (an) {
        await pushAnmelden(publicKey);
        toast.success('Dieses Gerät bekommt jetzt Meldungen.');
      } else {
        await pushAbmelden();
        toast.success('Dieses Gerät ist abgemeldet.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Das hat nicht geklappt.');
    } finally {
      await aktualisieren(publicKey);
      setBusy(false);
    }
  }

  // Kein Schlüsselpaar, oder der Browser kann es nicht: nichts anzeigen.
  if (zustand === 'nicht-eingerichtet' || zustand === 'nicht-moeglich') return null;

  return (
    <ToggleRow
      title="Meldungen auf dieses Gerät"
      description={
        zustand === 'abgelehnt'
          ? 'Der Browser hat Mitteilungen für diese Seite abgelehnt – das lässt sich nur in seinen Einstellungen zurücknehmen.'
          : 'Erreicht dich auch, wenn das Panel geschlossen ist. Gilt nur für diesen Browser; andere Geräte meldest du dort an.'
      }
      checked={zustand === 'an'}
      disabled={busy || zustand === 'abgelehnt'}
      onChange={(an) => void umschalten(an)}
    />
  );
}
