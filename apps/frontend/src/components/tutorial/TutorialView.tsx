'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import {
  Button,
  ButtonLink,
  Icon,
  PageHeader,
  Panel,
  ToggleRow,
  useToast,
} from '@/components/shared';
import { FluchtKnopf } from './FluchtKnopf';
import { useRundgang } from './RundgangProvider';
import { Quiz } from './Quiz';
import { Urkunde } from './Urkunde';
import { sichtbareSchritte, type TutorialSchritt } from './inhalt';
import { QUIZ_FRAGEN, quizBeantwortet, quizPunkte } from './fragenkatalog';
import {
  angezeigteGesamt,
  gesamtHinweis,
  lesezeitSpruch,
  lesezeitUrteil,
  luegenProzent,
  type Bilanz,
} from './spott';

/**
 * Die Einweisung ins Panel – freiwillig, überspringbar und leicht übergriffig.
 *
 * Sie erklärt jeden Bereich der Seitenleiste in einem Schritt (`inhalt.ts`) und
 * zieht den Nutzer dabei auf. Palantir läuft auf einem Homeserver für einen
 * festen Freundeskreis (Lastenheft §1); eine Einweisung im Ton einer
 * Betriebsanleitung läse dort niemand zu Ende. Die Erklärungen selbst stimmen –
 * der Spott steht daneben, nicht darin.
 *
 * Drei Scherze sind eingebaut, und alle drei haben eine Grenze:
 *
 * 1. **Der Überspringen-Knopf weicht aus** – vier Mal, dann steht er still
 *    ({@link FluchtKnopf}). Auf dem Telefon und bei reduzierter Bewegung
 *    überhaupt nicht.
 * 2. **Zu schnelles Weiterklicken wird einmal je Schritt abgelehnt.** Beim
 *    zweiten Versuch geht es weiter – niemand sitzt hier fest.
 * 3. **Der Haken „Ich habe das gelesen" glaubt dir nicht** und geht kurz nach
 *    dem Setzen von selbst wieder auf. Er sperrt nichts; er kommentiert nur.
 *
 * Die Zählerstände (zu früh geklickt, Fluchtversuche, Quizpunkte) laufen in der
 * {@link Bilanz} zusammen und ergeben am Ende die Note auf der Urkunde. Nichts
 * davon verlässt den Browser: Die Einweisung hat kein Backend, keinen
 * Speicherstand und kein Gedächtnis über den Seitenwechsel hinaus. Sie ist ein
 * Scherz mit Erklärungen, keine geführte Tour mit Fortschritt am Konto.
 */

type Phase = 'start' | 'schritt' | 'quiz' | 'urkunde';

export function TutorialView() {
  const { user } = useSession();
  const rundgang = useRundgang();

  const schritte = useMemo(() => sichtbareSchritte(user), [user]);

  const [phase, setPhase] = useState<Phase>('start');
  const [gewaehlterIndex, setIndex] = useState(0);
  const [ueberflogen, setUeberflogen] = useState(0);
  const [fluchtversuche, setFluchtversuche] = useState(0);
  const [hakenZweifel, setHakenZweifel] = useState(0);
  const [uebersprungen, setUebersprungen] = useState(false);
  const [antworten, setAntworten] = useState<(number | null)[]>(() => QUIZ_FRAGEN.map(() => null));

  const gesamt = schritte.length;

  /**
   * Der Schritt, der wirklich gezeigt wird.
   *
   * Welche Schritte es gibt, hängt am Konto – und das lädt der `SessionProvider`
   * erst nach dem ersten Rendern. Die Liste wird dabei in aller Regel länger;
   * wird sie ausnahmsweise kürzer, stünde der Nutzer ohne diese Klammer vor
   * einer leeren Seite ohne Knöpfe.
   */
  const index = Math.min(gewaehlterIndex, Math.max(0, gesamt - 1));
  const schritt = schritte[index];

  const bilanz: Bilanz = {
    ueberflogen,
    fluchtversuche,
    quizPunkte: quizPunkte(antworten),
    quizBeantwortet: quizBeantwortet(antworten),
    quizGesamt: QUIZ_FRAGEN.length,
  };

  function voran(): void {
    if (index + 1 < gesamt) {
      setIndex(index + 1);
      return;
    }

    setPhase('quiz');
  }

  function nochmal(): void {
    setPhase('start');
    setIndex(0);
    setUeberflogen(0);
    setFluchtversuche(0);
    setHakenZweifel(0);
    setUebersprungen(false);
    setAntworten(QUIZ_FRAGEN.map(() => null));
  }

  function ueberspringen(): void {
    setUebersprungen(true);
    setPhase('urkunde');
  }

  return (
    <>
      <PageHeader
        title="Tutorial"
        subtitle="Die Einweisung, um die niemand gebeten hat. Jetzt sind wir beide hier."
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5">
        {phase === 'start' ? (
          <Panel className="flex flex-col items-start gap-3">
            <Icon name="cap" size={28} className="text-brand" />
            <h2 className="text-2xl font-bold text-ink">
              Willkommen{user ? `, ${user.displayName}` : ''}.
            </h2>
            <p className="text-base text-ink-muted">
              Du hast dich erfolgreich angemeldet. Das war der schwerste Teil, und du hast ihn
              geschafft – wir sind alle sehr stolz. In {gesamt} Schritten zeigen wir dir, was dieses
              Panel kann. Danach gibt es eine Prüfung. Nein, das ist kein Scherz. Also: doch, schon,
              aber die Prüfung gibt es trotzdem.
            </p>
            <p className="text-base text-ink-soft">
              Die Erklärungen stimmen übrigens alle. Nur der Ton ist gelogen.
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button variant="primary" iconRight="arrowRight" onClick={() => setPhase('schritt')}>
                Ich bin bereit
              </Button>
              {/*
                Für alle, die es eilig haben: der Rundgang zeigt dieselben
                Bereiche in einer halben Minute, direkt an den echten Knöpfen.
              */}
              <Button variant="secondary" iconLeft="play" onClick={rundgang.starten}>
                Lieber der kurze Rundgang
              </Button>
              <FluchtKnopf onTreffer={ueberspringen} onFlucht={setFluchtversuche} />
            </div>
          </Panel>
        ) : null}

        {phase === 'schritt' && schritt ? (
          <SchrittKarte
            // Der Schlüssel ist die ganze Zustandsverwaltung dieses Schritts:
            // Beim Wechsel hängt React die Karte neu ein, und Lesezeit-Uhr,
            // Mahnung und Haken fangen von selbst wieder bei null an. Ein
            // Zurücksetzen von Hand in einem Effekt wäre genau die Kaskade, vor
            // der `react-hooks/set-state-in-effect` warnt.
            key={schritt.key}
            schritt={schritt}
            index={index}
            gesamt={gesamt}
            ueberflogen={ueberflogen}
            hakenZweifel={hakenZweifel}
            onUeberflogen={() => setUeberflogen(ueberflogen + 1)}
            onHakenZweifel={() => setHakenZweifel((zahl) => zahl + 1)}
            onWeiter={voran}
            onZurueck={() => setIndex(Math.max(0, index - 1))}
            onUeberspringen={ueberspringen}
            onFlucht={setFluchtversuche}
          />
        ) : null}

        {phase === 'quiz' ? (
          <Quiz
            antworten={antworten}
            onAntwort={(frage, antwort) =>
              setAntworten((alt) => alt.map((wert, i) => (i === frage ? antwort : wert)))
            }
            onFertig={() => setPhase('urkunde')}
          />
        ) : null}

        {phase === 'urkunde' ? (
          <Urkunde
            name={user?.displayName ?? 'Jemand ohne Namen'}
            bilanz={bilanz}
            uebersprungen={uebersprungen}
            onNochmal={nochmal}
          />
        ) : null}
      </div>
    </>
  );
}

/** So lange bleibt der Haken gesetzt, bevor er sich selbst wieder löst. */
const HAKEN_ZWEIFEL_MS = 700;

const HAKEN_ECHOS = [
  'Nein. Du hast nicht.',
  'Wir haben nachgesehen. Der Haken bleibt unten.',
  'Netter Versuch. Er geht wieder auf.',
  'Der Haken glaubt dir genauso wenig wie beim letzten Mal.',
] as const;

interface SchrittKarteProps {
  schritt: TutorialSchritt;
  index: number;
  gesamt: number;
  /** Bisherige zu schnelle Klicks – wählt den nächsten Spruch aus. */
  ueberflogen: number;
  /** Bisher gelöste Haken – wählt das nächste Echo aus. */
  hakenZweifel: number;
  onUeberflogen: () => void;
  onHakenZweifel: () => void;
  onWeiter: () => void;
  onZurueck: () => void;
  onUeberspringen: () => void;
  onFlucht: (versuche: number) => void;
}

/**
 * Ein Schritt der Einweisung – Erklärung, Spitze und die beiden Scherze dazu.
 *
 * Die Karte hält ihren eigenen Zustand (Lesezeit-Uhr, ob schon gemahnt wurde,
 * der Haken) und wird von der Ansicht über den Schlüssel neu eingehängt. Was
 * für die Urkunde zählt, meldet sie nach oben; die Bilanz liegt in der Ansicht,
 * weil sie den Schrittwechsel überleben muss.
 */
function SchrittKarte({
  schritt,
  index,
  gesamt,
  ueberflogen,
  hakenZweifel,
  onUeberflogen,
  onHakenZweifel,
  onWeiter,
  onZurueck,
  onUeberspringen,
  onFlucht,
}: SchrittKarteProps) {
  const toast = useToast();

  /** Einmal je Schritt wird eine zu kurze Lesezeit abgelehnt – danach nicht mehr. */
  const [gemahnt, setGemahnt] = useState(false);
  const [haken, setHaken] = useState(false);
  const [hakenEcho, setHakenEcho] = useState<string | null>(null);

  /** Zeitpunkt, an dem dieser Schritt betreten wurde (Grundlage der Lesezeit). */
  const betreten = useRef(0);
  const zweifel = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Die Uhr startet nach dem ersten Rendern, nicht währenddessen: `Date.now()`
  // im Rumpf wäre ein unreiner Aufruf beim Rendern.
  useEffect(() => {
    betreten.current = Date.now();

    return () => {
      if (zweifel.current) clearTimeout(zweifel.current);
    };
  }, []);

  function weiter(): void {
    const gebraucht = Date.now() - betreten.current;
    const urteil = lesezeitUrteil(gebraucht);
    const spruch = lesezeitSpruch(gebraucht, ueberflogen);

    if (urteil === 'ueberflogen') {
      onUeberflogen();

      // Beim ersten Mal je Schritt bleibt die Einweisung stehen; beim zweiten
      // Klick geht es weiter, auch wenn er genauso schnell kam. Ein Tutorial,
      // das den Nutzer dauerhaft festhält, ist kein Scherz mehr.
      if (!gemahnt) {
        setGemahnt(true);
        if (spruch) toast.warning(spruch);
        return;
      }
    }

    if (urteil === 'eingeschlafen' && spruch) toast.show(spruch);

    onWeiter();
  }

  function zweifelnAmHaken(gesetzt: boolean): void {
    setHaken(gesetzt);

    if (!gesetzt) {
      setHakenEcho(null);
      return;
    }

    if (zweifel.current) clearTimeout(zweifel.current);
    zweifel.current = setTimeout(() => {
      setHaken(false);
      setHakenEcho(HAKEN_ECHOS[hakenZweifel % HAKEN_ECHOS.length] ?? null);
      onHakenZweifel();
    }, HAKEN_ZWEIFEL_MS);
  }

  return (
    <>
      <Fortschritt index={index} gesamt={gesamt} />

      <Panel>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile bg-brand-soft text-brand">
            <Icon name={schritt.icon} size={18} />
          </span>
          <h2 className="text-xl font-bold text-ink">{schritt.titel}</h2>
        </div>

        <p className="mt-3 text-base text-ink-muted">{schritt.erklaerung}</p>

        <div className="mt-3 flex items-start gap-2.5 rounded-md border border-line bg-fill px-3.5 py-3">
          <Icon name="smile" size={16} className="mt-0.5 shrink-0 text-caution" />
          <p className="text-base text-ink-soft">{schritt.spitze}</p>
        </div>

        <div className="mt-4">
          <ToggleRow
            title="Ich habe das wirklich gelesen"
            description={hakenEcho ?? 'Dieser Haken hat keine Wirkung. Setz ihn trotzdem.'}
            checked={haken}
            onChange={zweifelnAmHaken}
          />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" iconLeft="arrowLeft" disabled={index === 0} onClick={onZurueck}>
            Zurück
          </Button>
          <ButtonLink href={schritt.href} variant="secondary" iconRight="arrowRight">
            Zeig mir das
          </ButtonLink>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FluchtKnopf onTreffer={onUeberspringen} onFlucht={onFlucht} />
          <Button variant="primary" iconRight="arrowRight" onClick={weiter}>
            {index + 1 === gesamt ? 'Zur Prüfung' : 'Weiter'}
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * Schrittzähler und Balken – beide nicht ganz bei der Wahrheit.
 *
 * Die Gesamtzahl wächst in der Mitte um eins und stimmt am Ende wieder
 * ({@link angezeigteGesamt}); der Balken hängt beim letzten Schritt bei 99 %
 * fest ({@link luegenProzent}). `aria-valuetext` sagt dasselbe wie die Anzeige –
 * wer sich die Seite vorlesen lässt, soll denselben Scherz bekommen und nicht
 * die ehrliche Zahl.
 */
function Fortschritt({ index, gesamt }: { index: number; gesamt: number }) {
  const anzeige = angezeigteGesamt(index, gesamt);
  const hinweis = gesamtHinweis(index, gesamt);
  const prozent = luegenProzent(index, gesamt);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base text-ink-muted">
          Schritt {index + 1} von {anzeige}
          {hinweis ? <span className="ml-2 text-xs text-ink-faint">{hinweis}</span> : null}
        </span>
        <span className="font-mono text-xs text-ink-faint">{prozent} %</span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={prozent}
        aria-valuetext={`${prozent} Prozent – Schritt ${index + 1} von ${anzeige}`}
        className="h-1.5 w-full overflow-hidden rounded-sm bg-fill"
      >
        <div
          className="h-full rounded-sm bg-brand-gradient transition-[width] duration-300 ease-out"
          style={{ width: `${prozent}%` }}
        />
      </div>
    </div>
  );
}
