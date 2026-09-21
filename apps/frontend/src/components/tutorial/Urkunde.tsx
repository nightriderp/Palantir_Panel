'use client';

import { Button, ButtonLink, Icon, Panel, formatDate, useToast } from '@/components/shared';
import { ausdauerTitel, notentext, zeugnis, type Bilanz } from './spott';

export interface UrkundeProps {
  /** Anzeigename des Kontos – ohne Konto steht dort ein Platzhalter. */
  name: string;
  bilanz: Bilanz;
  /** Der „Überspringen"-Knopf wurde erwischt. Andere Urkunde, andere Note. */
  uebersprungen: boolean;
  onNochmal: () => void;
}

/**
 * Die Urkunde am Ende – das einzige Ergebnis dieser Einweisung.
 *
 * Sie rechnet nichts schön: Die Note kommt aus {@link zeugnis} und damit aus
 * dem, was der Nutzer unterwegs wirklich getan hat (zu früh geklickt, den
 * Überspringen-Knopf gejagt, das Quiz verhauen). Genau das macht den Spaß aus –
 * eine Urkunde, die immer „sehr gut" sagt, liest niemand zweimal.
 *
 * Wer übersprungen hat, bekommt seine eigene Fassung. Nicht als Strafe: Der
 * Knopf hat vier Mal versucht, das zu verhindern, und wer ihn trotzdem trifft,
 * hat sich eine Urkunde dafür verdient.
 */
export function Urkunde({ name, bilanz, uebersprungen, onNochmal }: UrkundeProps) {
  const toast = useToast();
  const { wert, begruendung } = zeugnis(bilanz);
  const heute = formatDate(new Date().toISOString());
  const note = uebersprungen ? 5 : wert;
  const ausdauer = ausdauerTitel(bilanz.quizBeantwortet, bilanz.quizGesamt);

  const satz = uebersprungen
    ? `${name} hat die Einweisung übersprungen und den Knopf dafür vier Mal jagen müssen. Das ist auch eine Leistung.`
    : `${name} hat die Einweisung in das Palantir-Panel vollständig über sich ergehen lassen.`;

  async function kopieren(): Promise<void> {
    const text = [
      'URKUNDE',
      satz,
      `Note: ${note} – ${notentext(note)}`,
      uebersprungen ? '' : ausdauer,
      uebersprungen ? '' : `Begründung: ${begruendung}`,
      `Ausgestellt am ${heute} von einem Panel, das niemand darum gebeten hat.`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      toast.success('Urkunde kopiert. Häng sie dir über den Schreibtisch.');
    } catch {
      toast.error('Kopieren ging nicht. Schreib sie ab, das prägt sich besser ein.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="text-center">
        <Icon name="cap" size={32} className="mx-auto text-brand" />

        <div className="mt-2 text-2xs uppercase tracking-[0.3em] text-ink-soft">Urkunde</div>
        <div className="mt-3 text-3xl font-bold text-ink">{name}</div>

        <p className="mx-auto mt-3 max-w-xl text-base text-ink-muted">{satz}</p>

        <div className="mt-5 inline-flex flex-col items-center gap-1 rounded-xl border border-brand-line bg-brand-soft px-6 py-3">
          <span className="text-2xs uppercase tracking-[0.1em] text-ink-soft">Note</span>
          <span className="font-mono text-4xl font-bold text-white">{note}</span>
        </div>

        <p className="mt-3 text-base text-ink">{notentext(note)}</p>
        {uebersprungen ? null : (
          <>
            {/*
              Die Note bewertet das Wie, dieser Satz das Wieviel: Drei Fragen
              und 124 Fragen sind nicht dieselbe Leistung, auch wenn beide eine
              Vier ergeben können.
            */}
            <p className="mx-auto mt-3 max-w-xl text-base text-ink-muted">{ausdauer}</p>
            <p className="mt-2 text-sm text-ink-faint">{begruendung}</p>
          </>
        )}

        <p className="mt-5 text-xs text-ink-faint">
          Ausgestellt am {heute}. Ohne Unterschrift, ohne Siegel, ohne jeden Wert.
        </p>
      </Panel>

      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Button variant="secondary" iconLeft="copy" onClick={() => void kopieren()}>
          Urkunde kopieren
        </Button>
        <Button variant="ghost" iconLeft="restart" onClick={onNochmal}>
          Nochmal von vorn
        </Button>
        <ButtonLink href="/servers" variant="primary" iconRight="arrowRight">
          Lass mich endlich zu den Servern
        </ButtonLink>
      </div>
    </div>
  );
}
