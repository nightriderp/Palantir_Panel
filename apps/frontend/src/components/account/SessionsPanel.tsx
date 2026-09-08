'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type SessionDto } from '@palantir/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  Panel,
  formatDateTime,
  formatRelativeTime,
  useToast,
} from '@/components/shared';
import { loadSessions } from '@/lib/api/session';
import { useApiResource } from '@/lib/api/useApiResource';
import { revokeOtherSessions, revokeSession } from '@/lib/auth/api';
import { messageForThrown } from '@/lib/auth/errors';

/**
 * Aktive Sitzungen des eigenen Kontos (Lastenheft §3.1, Fundstelle
 * spec-lastenheft-01).
 *
 * Das Backend liefert die Geräteübersicht seit B1 (`GET /auth/sessions`), das
 * Frontend hat sie nie angebunden: Wer eine Sitzung auf einem fremden Rechner
 * vergessen hatte, kam ohne Handarbeit nicht mehr an sie heran. Der Abschnitt
 * schließt genau diese Lücke – Liste, „Abmelden" je Gerät, „Alle anderen
 * abmelden".
 *
 * **Auch die eigene Sitzung ist abmeldbar.** Das DTO trägt für sie
 * `permissions.canRevoke === true` (`modules/auth/dto.ts`: „Jede eigene Sitzung
 * ist einzeln abmeldbar, auch die aktuelle – das ist dann schlicht ein
 * Logout"), und das Backend räumt dabei die Sitzungs-Cookies mit ab. Ein Knopf,
 * den die Ansicht entgegen dem `permissions`-Objekt ausblendet, wäre eine
 * zweite, abweichende Rechteentscheidung im Frontend (Pflichtenheft §5.2).
 * Deshalb steht er dort – nur mit anderem Bestätigungstext, und danach geht es
 * zurück zur Anmeldung.
 *
 * „Alle anderen abmelden" ist **ein** Aufruf (`DELETE /auth/sessions`, Fundpunkt
 * 140). Vorher schickte die Aktion ein `DELETE` je Gerät und wertete die
 * Antworten einzeln aus – bei zehn Geräten zehn Anfragen, und fiel eine davon
 * aus, blieb dieses Gerät angemeldet, während die Erfolgsmeldung für die
 * übrigen erschien. Jetzt widerruft das Backend in einem Statement und liefert
 * die verbleibenden Sitzungen zurück; die Liste kommt also aus der Antwort und
 * nicht aus einer Annahme der Oberfläche.
 */

/** Was der offene Bestätigungsdialog gerade vorhat. */
type Vorhaben = { art: 'einzeln'; session: SessionDto } | { art: 'alle' };

/** Anzeigename eines Geräts – der User-Agent kann fehlen. */
function geraeteName(session: SessionDto): string {
  return session.deviceInfo ?? 'Unbekanntes Gerät';
}

export function SessionsPanel() {
  const { data, loading, error, reload, setData } = useApiResource(() => loadSessions(), []);
  const toast = useToast();
  const router = useRouter();
  const [vorhaben, setVorhaben] = useState<Vorhaben | null>(null);
  const [busy, setBusy] = useState(false);

  const sessions = data ?? [];
  // „Alle anderen" heißt: alles außer der eigenen Sitzung, und nur, was der
  // Vertrag freigibt.
  const andere = sessions.filter((session) => !session.current && session.permissions.canRevoke);

  /** Eine Sitzung aus der Liste nehmen, ohne neu zu laden. */
  function entferne(ids: ReadonlySet<string>): void {
    setData((bisher) => (bisher ?? []).filter((session) => !ids.has(session.id)));
  }

  async function meldeEinzelnAb(session: SessionDto): Promise<void> {
    await revokeSession(session.id);
    entferne(new Set([session.id]));

    if (session.current) {
      // Die Cookies sind weg – hier zu bleiben hieße, jeden weiteren Aufruf in
      // ein `AUTH_REQUIRED` laufen zu lassen. `refresh`, damit die Middleware
      // die fehlende Sitzung sieht (gleicher Ablauf wie im Konto-Menü).
      toast.success('Du wurdest auf diesem Gerät abgemeldet.');
      router.push('/login');
      router.refresh();
      return;
    }

    toast.success(`${geraeteName(session)} wurde abgemeldet.`);
  }

  async function meldeAlleAnderenAb(): Promise<void> {
    const vorher = andere.length;
    /*
     * Ein Aufruf, und die Antwort ist die neue Liste (Fundpunkt 140). Ein
     * Fehlschlag wirft und wird in `bestaetigen()` gemeldet – dann bleibt die
     * Liste unverändert stehen, weil das Backend nichts widerrufen hat.
     */
    const verbleibend = await revokeOtherSessions();
    setData(() => verbleibend);

    toast.success(
      vorher === 1 ? 'Ein Gerät wurde abgemeldet.' : `${vorher} Geräte wurden abgemeldet.`,
    );
  }

  async function bestaetigen(): Promise<void> {
    if (vorhaben === null || busy) return;

    setBusy(true);
    try {
      if (vorhaben.art === 'alle') {
        await meldeAlleAnderenAb();
      } else {
        await meldeEinzelnAb(vorhaben.session);
      }
      setVorhaben(null);
    } catch (thrown) {
      // Der Eintrag bleibt stehen: Solange das Backend nicht bestätigt hat, ist
      // die Sitzung weiter gültig, und eine verschwundene Zeile würde das
      // Gegenteil behaupten.
      toast.error(messageForThrown(thrown));
      setVorhaben(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-ink">Aktive Sitzungen</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Geräte, die gerade an deinem Konto angemeldet sind. Kommt dir eines fremd vor, melde es
            hier ab – das Gerät braucht dann eine neue Anmeldung.
          </p>
        </div>

        {andere.length > 0 ? (
          <Button
            variant="danger"
            size="sm"
            iconLeft="logout"
            disabled={busy}
            onClick={() => setVorhaben({ art: 'alle' })}
          >
            Alle anderen abmelden
          </Button>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 text-base text-ink-muted">Sitzungen werden geladen …</p>
      ) : error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-base text-danger">{error}</p>
          <Button size="sm" iconLeft="restart" onClick={reload}>
            Nochmal versuchen
          </Button>
        </div>
      ) : sessions.length === 0 ? (
        <p className="mt-4 text-base text-ink-muted">Zurzeit ist kein Gerät angemeldet.</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-line">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fill-strong text-ink-muted">
                <Icon name="shield" size={14} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-base text-ink">
                  <span className="truncate">{geraeteName(session)}</span>
                  {session.current ? <Badge tone="brand">Dieses Gerät</Badge> : null}
                </p>
                <p
                  className="truncate text-xs text-ink-faint"
                  title={`Sitzung läuft ab am ${formatDateTime(session.expiresAt)}`}
                >
                  {session.ipHint === null ? 'Herkunft unbekannt' : `Herkunft ${session.ipHint}`} ·
                  zuletzt aktiv {formatRelativeTime(session.lastUsedAt)} · angemeldet seit{' '}
                  {formatDateTime(session.createdAt)}
                </p>
              </div>

              <Button
                variant="danger"
                size="sm"
                iconLeft="logout"
                disabled={!session.permissions.canRevoke || busy}
                aria-label={`Abmelden: ${session.current ? 'dieses Gerät' : geraeteName(session)}`}
                onClick={() => setVorhaben({ art: 'einzeln', session })}
              >
                Abmelden
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={vorhaben !== null}
        onClose={() => (busy ? undefined : setVorhaben(null))}
        title={dialogTitel(vorhaben)}
        message={dialogText(vorhaben, andere.length)}
        confirmLabel="Abmelden"
        onConfirm={() => void bestaetigen()}
        busy={busy}
      />
    </Panel>
  );
}

function dialogTitel(vorhaben: Vorhaben | null): string {
  if (vorhaben === null) return '';
  if (vorhaben.art === 'alle') return 'Alle anderen Geräte abmelden';
  return vorhaben.session.current ? 'Dieses Gerät abmelden' : 'Gerät abmelden';
}

function dialogText(vorhaben: Vorhaben | null, anzahlAndere: number): string {
  if (vorhaben === null) return '';

  if (vorhaben.art === 'alle') {
    const geraete =
      anzahlAndere === 1 ? 'Ein weiteres Gerät wird' : `${anzahlAndere} weitere Geräte werden`;
    return `${geraete} abgemeldet. Dieses Gerät bleibt angemeldet.`;
  }

  if (vorhaben.session.current) {
    return 'Du wirst auf diesem Gerät abgemeldet und landest wieder bei der Anmeldung. Andere Geräte bleiben angemeldet.';
  }

  return `„${geraeteName(vorhaben.session)}" wird abgemeldet. Wer dort weiterarbeiten will, muss sich neu anmelden.`;
}
