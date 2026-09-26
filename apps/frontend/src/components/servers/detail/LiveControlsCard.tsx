'use client';

import {
  type GameConfigField,
  type GameConfigValue,
  type GameConfigValues,
  type GameLiveControl,
  type GameServerDto,
  type GameTypeDto,
  isTransitionalServerStatus,
} from '@palantir/contracts';
import { useMemo, useState } from 'react';
import { Button, Panel, Toggle, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { applyLiveValues, fetchGameTypes, runLifecycleAction } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { ConfigFields } from '../form/ConfigFields';
import { EigeneProfile } from './EigeneProfile';

/**
 * Steuerung (Betreiber-Wunsch 23.09.2026): Karte, Modus, Bots und was ein Spiel
 * sonst anbietet (`GameTypeDto.liveControls`) schnell umstellen – bei laufendem
 * Server sofort, ohne Neustart; bei ausgeschaltetem gilt es beim nächsten Start.
 * Gesperrt nur, solange der Server startet oder stoppt.
 *
 * Steht in der Übersicht rechts neben der Konsole: Nach „Übernehmen“ sieht man
 * dort, dass die Karte lädt oder Bots beitreten.
 *
 * **Was hier geändert wird, bleibt** – über Stopp und Neustart hinweg
 * (Betreiber 23.09.2026). Das Backend schreibt die Werte in die Einstellungen;
 * angezeigt wird deshalb, was dort steht, sonst die Vorgabe des Feldes.
 * (`liveValues` zählt noch mit: Reste aus v2.4.6, als Live-Werte bis zum
 * nächsten Start galten.)
 *
 * **Plugins** (24.09.2026, Fundpunkt 361): Abschnitte mit `requiresRestart`
 * wirken erst mit einem Neustart – bei laufendem Server heißt der Knopf dann
 * „Übernehmen & neu starten“ und startet nach dem Speichern neu. `collapsible`
 * zeigt eine Kurzzeile und klappt mit „Anpassen“ auf; `disabledWhen` sperrt
 * einen Abschnitt mit Hinweis (Bots, solange ein Spielmodus-Plugin sie selbst
 * verwaltet).
 */
export interface LiveControlsCardProps {
  server: GameServerDto;
  /** Nach erfolgreicher Übernahme – die Seite übernimmt den neuen Stand. */
  onChanged: (server: GameServerDto) => void;
}

/** Anzeigename eines Werts: Auswahl über `optionLabels`, sonst der Wert. */
function wertText(feld: GameConfigField | undefined, wert: GameConfigValue | undefined): string {
  const text = String(wert ?? '');

  return feld?.optionLabels?.[text] ?? text;
}

/**
 * Kurzzeile eines eingeklappten Abschnitts: eingeschaltete Schalter mit ihrem
 * Namen, Auswahlen mit ihrem Anzeigenamen (außer „keins“), Zahlen mit Namen und
 * Wert. Ausgeschaltetes fehlt – die Zeile sagt, was an ist.
 */
function kurzzeile(
  steuerung: GameLiveControl,
  felder: readonly GameConfigField[],
  werte: GameConfigValues,
): string {
  const teile: string[] = [];

  for (const key of steuerung.fields) {
    const feld = felder.find((f) => f.key === key);
    const wert = werte[key];

    if (feld === undefined || wert === undefined) continue;

    if (feld.type === 'toggle') {
      if (wert === true) teile.push(feld.label);
    } else if (feld.type === 'select') {
      if (wert !== 'none' && wert !== '') teile.push(wertText(feld, wert));
    } else if (feld.type === 'number') {
      teile.push(`${feld.label}: ${String(wert)}`);
    }
  }

  return teile.length === 0 ? 'Nichts aktiv' : teile.join(' · ');
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
  const [basis, setBasis] = useState<GameConfigValues>(aktuell);
  const [busy, setBusy] = useState(false);
  const [aufgeklappt, setAufgeklappt] = useState<ReadonlySet<string>>(() => new Set());

  // Kommt ein neuer Stand (Übernahme, Neustart), gilt er – ein alter Entwurf
  // bliebe sonst stehen, obwohl der Server längst etwas anderes spielt.
  // Abgeglichen während des Renderns statt in einem Effekt: So empfiehlt es
  // React für Zustand, der von Props abhängt, und es gibt keine zweite Runde.
  if (basis !== aktuell) {
    setBasis(aktuell);
    setEntwurf(aktuell);
  }

  if (steuerungen.length === 0 || spiel === null) {
    return null;
  }

  const laeuft = server.status === 'running';
  const imUebergang = isTransitionalServerStatus(server.status);
  const geaendert = Object.keys(aktuell).filter((key) => entwurf[key] !== aktuell[key]);
  const laedtNeu = steuerungen.some(
    (steuerung) =>
      steuerung.reloadsMap === true && steuerung.fields.some((key) => geaendert.includes(key)),
  );
  // Plugins werden beim Start geladen: Läuft der Server, gehört zum Übernehmen
  // ein Neustart.
  const mitNeustart =
    laeuft &&
    steuerungen.some(
      (steuerung) =>
        steuerung.requiresRestart === true &&
        steuerung.fields.some((key) => geaendert.includes(key)),
    );

  /** Gesperrt durch `disabledWhen`? Dann der Hinweis, sonst `null`. */
  function sperrHinweis(steuerung: GameLiveControl): string | null {
    const bedingung = steuerung.disabledWhen;

    if (bedingung === undefined) return null;

    const wert = entwurf[bedingung.field];
    if (!bedingung.values.includes(String(wert))) return null;

    const feld = spiel?.configFields.find((f) => f.key === bedingung.field);

    return bedingung.hint.replace('{wert}', wertText(feld, wert));
  }

  function umschalten(id: string) {
    setAufgeklappt((bisher) => {
      const neu = new Set(bisher);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);

      return neu;
    });
  }

  async function uebernehmen() {
    const werte: Record<string, string | number | boolean> = {};

    for (const key of geaendert) {
      const wert = entwurf[key];

      if (typeof wert === 'string' || typeof wert === 'number' || typeof wert === 'boolean') {
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

    onChanged(ergebnis.data);

    if (mitNeustart) {
      setBusy(true);
      const neustart = await runLifecycleAction(server.id, 'restart');
      setBusy(false);

      if (!neustart.success) {
        toast.error(`Gespeichert, aber der Neustart scheiterte: ${errorText(neustart)}`);

        return;
      }

      onChanged(neustart.data);
      toast.success('Übernommen – der Server startet neu.');

      return;
    }

    toast.success(
      !laeuft
        ? 'Gespeichert – gilt beim nächsten Start.'
        : laedtNeu
          ? 'Übernommen – die Karte wird neu geladen.'
          : 'Übernommen.',
    );
  }

  // Aufeinanderfolgende Steuerungen mit derselben `group` bilden einen Block.
  const bloecke: { key: string; titel: string; gruppe?: string; steuerungen: GameLiveControl[] }[] =
    [];
  for (const steuerung of steuerungen) {
    const letzter = bloecke.at(-1);

    if (steuerung.group !== undefined && letzter?.gruppe === steuerung.group) {
      letzter.steuerungen.push(steuerung);
    } else {
      bloecke.push({
        key: steuerung.group ?? steuerung.id,
        titel: steuerung.group ?? steuerung.label,
        ...(steuerung.group === undefined ? {} : { gruppe: steuerung.group }),
        steuerungen: [steuerung],
      });
    }
  }

  /** Steuerungen einer Gruppe, die nur aus Schaltern bestehen – kommen ins Raster. */
  function nurSchalter(steuerung: GameLiveControl): boolean {
    if (spiel === null || steuerung.collapsible === true) return false;
    const felder = spiel.configFields.filter((feld) => steuerung.fields.includes(feld.key));
    return felder.length > 0 && felder.every((feld) => feld.type === 'toggle');
  }

  /**
   * Schalter links, Text rechts (Betreiber 25.09.2026) – in Gruppen als
   * zweispaltiges Raster. Die Beschreibung steht als Tooltip am Text.
   */
  function schalterZeilen(steuerung: GameLiveControl) {
    if (spiel === null) return null;
    const hinweis = sperrHinweis(steuerung);

    return spiel.configFields
      .filter((feld) => steuerung.fields.includes(feld.key))
      .map((feld) => (
        <div key={feld.key} className="flex min-w-0 items-start gap-2.5">
          <Toggle
            label={feld.label}
            checked={entwurf[feld.key] === true}
            disabled={imUebergang || busy || hinweis !== null}
            onChange={(wert) => setEntwurf((bisher) => ({ ...bisher, [feld.key]: wert }))}
          />
          <div className="min-w-0 pt-0.5">
            <span className="block text-sm leading-5" title={feld.description ?? undefined}>
              {feld.label}
            </span>
            {hinweis === null ? null : <p className="text-xs text-ink-faint">{hinweis}</p>}
          </div>
        </div>
      ));
  }

  /** Felder einer Steuerung – mit eigener Überschrift, oder ohne in einer Gruppe. */
  function abschnitt(steuerung: GameLiveControl, mitKopf: boolean) {
    const hinweis = sperrHinweis(steuerung);
    // Mit ungespeicherten Änderungen bleibt ein Abschnitt offen – sonst
    // verschwände, was gerade eingestellt wurde.
    const offen =
      steuerung.collapsible !== true ||
      aufgeklappt.has(steuerung.id) ||
      steuerung.fields.some((key) => geaendert.includes(key));

    if (spiel === null) return null;

    return (
      <>
        {mitKopf || steuerung.collapsible === true ? (
          <div className="flex items-center justify-between gap-2">
            {mitKopf ? (
              <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
                {steuerung.label}
              </p>
            ) : null}
            {steuerung.collapsible === true ? (
              <button
                type="button"
                onClick={() => umschalten(steuerung.id)}
                aria-expanded={offen}
                className="text-xs text-accent hover:underline"
              >
                {offen ? 'Einklappen' : 'Anpassen'}
              </button>
            ) : null}
          </div>
        ) : null}

        {offen ? (
          <ConfigFields
            fields={spiel.configFields.filter((feld) => steuerung.fields.includes(feld.key))}
            values={entwurf}
            onChange={(key: string, wert: GameConfigValue) =>
              setEntwurf((bisher) => ({ ...bisher, [key]: wert }))
            }
            lockAfterCreate={false}
            disabled={imUebergang || busy || hinweis !== null}
            hideHints={steuerung.showHints !== true}
            presets={spiel.presets ?? []}
            {...(spiel.presetField === undefined ? {} : { presetField: spiel.presetField })}
          />
        ) : (
          <p className="truncate text-sm text-ink-muted">
            {kurzzeile(steuerung, spiel.configFields, entwurf)}
          </p>
        )}

        {hinweis === null ? null : <p className="text-xs text-ink-faint">{hinweis}</p>}
      </>
    );
  }

  return (
    <Panel variant="plain">
      <h3 className="mb-3 text-base font-semibold">Steuerung</h3>

      <div className="flex flex-col gap-4">
        {/* Eigene Profile (Idee P / A2): wählen legt die Werte in den Entwurf. */}
        <EigeneProfile
          gameType={spiel.id}
          entwurf={entwurf}
          felder={steuerungen.flatMap((steuerung) => steuerung.fields)}
          onWaehlen={(werte) => setEntwurf((bisher) => ({ ...bisher, ...werte }))}
          disabled={imUebergang || busy}
        />

        {bloecke.map((block) =>
          block.gruppe === undefined ? (
            <section key={block.key} aria-label={block.titel} className="flex flex-col gap-2">
              {abschnitt(block.steuerungen[0] as GameLiveControl, true)}
            </section>
          ) : (
            // Gruppe (`group`): eine Überschrift, die Schalter zweispaltig,
            // alles andere (etwa das Spielmodus-Plugin) darunter in voller Breite.
            <section key={block.key} aria-label={block.titel} className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
                {block.titel}
              </p>
              {block.steuerungen.some(nurSchalter) ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {block.steuerungen.filter(nurSchalter).map(schalterZeilen)}
                </div>
              ) : null}
              {block.steuerungen
                .filter((steuerung) => !nurSchalter(steuerung))
                .map((steuerung) => (
                  <div key={steuerung.id} className="flex flex-col gap-2">
                    {abschnitt(steuerung, false)}
                  </div>
                ))}
            </section>
          ),
        )}
      </div>

      {imUebergang ? (
        <p className="mt-3 text-sm text-ink-faint">
          Der Server startet oder stoppt gerade – gleich wieder möglich.
        </p>
      ) : laeuft ? null : (
        <p className="mt-3 text-sm text-ink-faint">
          Der Server ist aus – die Werte gelten beim nächsten Start.
        </p>
      )}

      {laeuft && laedtNeu && !mitNeustart ? (
        <p className="mt-3 text-sm text-warning">
          Die Karte wird neu geladen – verbundene Spieler sind kurz getrennt.
        </p>
      ) : null}

      {mitNeustart ? (
        <p className="mt-3 text-sm text-warning">
          Plugins werden beim Start geladen – der Server startet dafür neu, verbundene Spieler
          werden getrennt.
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          disabled={imUebergang || busy || geaendert.length === 0}
          onClick={() => void uebernehmen()}
        >
          {mitNeustart ? 'Übernehmen & neu starten' : 'Übernehmen'}
        </Button>
      </div>
    </Panel>
  );
}
