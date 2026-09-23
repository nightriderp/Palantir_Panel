'use client';

import {
  type GameConfigValue,
  type GameConfigValues,
  type GameServerDto,
  type GameTypeDto,
} from '@palantir/contracts';
import { useEffect, useMemo, useState } from 'react';
import { Button, Panel, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { applyLiveValues, fetchGameTypes } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { ConfigFields } from '../form/ConfigFields';

/**
 * Live-Steuerung (Betreiber-Wunsch 23.09.2026): Einstellungen eines laufenden
 * Servers ändern, ohne Neustart – Karte, Modus, Bots und was ein Spiel sonst
 * live anbietet (`GameTypeDto.liveControls`).
 *
 * Steht in der Übersicht rechts neben der Konsole: Nach „Übernehmen“ sieht man
 * dort, dass die Karte lädt oder Bots beitreten.
 *
 * **Die Einstellungen bleiben die Startwerte.** Was hier geändert wird, gilt
 * bis zum nächsten Start; angezeigt wird, was gerade gilt – live Geändertes vor
 * den Einstellungen, die vor den Vorgaben der Felder.
 */
export interface LiveControlsCardProps {
  server: GameServerDto;
  /** Nach erfolgreicher Übernahme – die Seite übernimmt die neuen Live-Werte. */
  onChanged: (liveValues: GameConfigValues | null) => void;
}

export function LiveControlsCard({ server, onChanged }: LiveControlsCardProps) {
  const toast = useToast();
  const spiele = useApiResource<GameTypeDto[]>((signal) => fetchGameTypes(signal), []);
  const spiel = spiele.data?.find((eintrag) => eintrag.id === server.gameType) ?? null;
  // Stabil halten: Ein bei jedem Rendern neues leeres Array ließe `aktuell`
  // neu rechnen, und der Effekt unten setzte den Entwurf ohne Ende.
  const steuerungen = useMemo(() => spiel?.liveControls ?? [], [spiel]);

  const aktuell = useMemo<GameConfigValues>(() => {
    const werte: GameConfigValues = {};

    for (const steuerung of steuerungen) {
      for (const key of steuerung.fields) {
        const feld = spiel?.configFields.find((f) => f.key === key);
        const start = server.config[key] ?? feld?.defaultValue;

        if (start !== undefined) {
          werte[key] = start;
        }
      }
    }

    return { ...werte, ...(server.liveValues ?? {}) };
  }, [steuerungen, spiel, server.config, server.liveValues]);

  const [entwurf, setEntwurf] = useState<GameConfigValues>(aktuell);
  const [busy, setBusy] = useState(false);

  // Kommt ein neuer Stand (Übernahme, Neustart), gilt er – ein alter Entwurf
  // bliebe sonst stehen, obwohl der Server längst etwas anderes spielt.
  useEffect(() => {
    setEntwurf(aktuell);
  }, [aktuell]);

  if (steuerungen.length === 0 || spiel === null) {
    return null;
  }

  const laeuft = server.status === 'running';
  const geaendert = Object.keys(aktuell).filter((key) => entwurf[key] !== aktuell[key]);
  const laedtNeu = steuerungen.some(
    (steuerung) =>
      steuerung.reloadsMap === true && steuerung.fields.some((key) => geaendert.includes(key)),
  );

  async function uebernehmen() {
    const werte: Record<string, string | number> = {};

    for (const key of geaendert) {
      const wert = entwurf[key];

      if (typeof wert === 'string' || typeof wert === 'number') {
        werte[key] = wert;
      }
    }

    setBusy(true);
    const ergebnis = await applyLiveValues(server.id, werte);
    setBusy(false);

    if (!ergebnis.success) {
      toast.error(errorText(ergebnis));

      return;
    }

    onChanged(ergebnis.data.liveValues);
    toast.success(laedtNeu ? 'Übernommen – die Karte wird neu geladen.' : 'Übernommen.');
  }

  return (
    <Panel variant="plain">
      <h3 className="mb-3 text-base font-semibold">Live-Steuerung</h3>

      <div className="flex flex-col gap-4">
        {steuerungen.map((steuerung) => (
          <section key={steuerung.id} aria-label={steuerung.label} className="flex flex-col gap-2">
            <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
              {steuerung.label}
            </p>
            <ConfigFields
              fields={spiel.configFields.filter((feld) => steuerung.fields.includes(feld.key))}
              values={entwurf}
              onChange={(key: string, wert: GameConfigValue) =>
                setEntwurf((bisher) => ({ ...bisher, [key]: wert }))
              }
              lockAfterCreate={false}
              disabled={!laeuft || busy}
              hideHints
            />
          </section>
        ))}
      </div>

      {laeuft ? null : (
        <p className="mt-3 text-sm text-ink-faint">
          Geht nur, solange der Server läuft. Die Startwerte stehen in den Einstellungen.
        </p>
      )}

      {laeuft && laedtNeu ? (
        <p className="mt-3 text-sm text-warning">
          Die Karte wird neu geladen – verbundene Spieler sind kurz getrennt.
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          disabled={!laeuft || busy || geaendert.length === 0}
          onClick={() => void uebernehmen()}
        >
          Übernehmen
        </Button>
      </div>
    </Panel>
  );
}
