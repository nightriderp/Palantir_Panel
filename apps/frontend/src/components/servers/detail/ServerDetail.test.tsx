import { type GameServerDto, type LiveServerEventFrame } from '@palantir/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { ownerPermissions, server as serverFixture } from '../testFixtures';
import { ServerDetail } from './ServerDetail';

/**
 * Fundpunkt event-flow-04 – Live-Kanal und REST-Antwort versöhnen.
 *
 * Der Test fährt genau den Ablauf aus dem Befund: Ein Server läuft laut REST,
 * der Kanal meldet später „gestoppt" (jünger, gewinnt), und der darauf folgende
 * Klick auf „Starten" liefert per REST den jüngsten Stand – der die alte
 * Live-Meldung ablösen muss. Vorher blieb die Kopfzeile auf „Offline" stehen
 * und der zweite Klick endete in `SERVER_STATE_CONFLICT`.
 */

const kanal = vi.hoisted(() => {
  const zuhoerer = new Set<(frame: unknown) => void>();

  return {
    zuhoerer,
    api: {
      connection: 'open' as const,
      subscribe(_topic: unknown, listener: (frame: unknown) => void) {
        zuhoerer.add(listener);

        return () => {
          zuhoerer.delete(listener);
        };
      },
      send: () => true,
    },
  };
});

const api = vi.hoisted(() => ({
  fetchServer: vi.fn(),
  runLifecycleAction: vi.fn(),
  fetchStatsHistory: vi.fn(),
  deleteServer: vi.fn(),
  updateServerImage: vi.fn(),
}));

vi.mock('@/lib/live/LiveChannelProvider', () => ({ useLiveChannel: () => kanal.api }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/servers/srv-1',
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchServer: api.fetchServer,
  runLifecycleAction: api.runLifecycleAction,
  fetchStatsHistory: api.fetchStatsHistory,
  deleteServer: api.deleteServer,
  updateServerImage: api.updateServerImage,
}));

const LAEUFT = serverFixture({ id: 'srv-1', name: 'Welt', status: 'running' });

function mitStatus(status: GameServerDto['status']): GameServerDto {
  return { ...LAEUFT, status };
}

function statusFrame(status: GameServerDto['status']): LiveServerEventFrame {
  return {
    kind: 'event',
    event: 'server.statusChanged',
    topic: { resource: 'server', id: 'srv-1' },
    sentAt: '2026-09-06T10:00:00.000Z',
    data: { serverId: 'srv-1', status, statusMessage: null },
  };
}

function sende(frame: LiveServerEventFrame): void {
  act(() => {
    for (const zuhoerer of kanal.zuhoerer) zuhoerer(frame);
  });
}

function zeichne() {
  return render(
    <ToastProvider>
      <ServerDetail serverId="srv-1" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  kanal.zuhoerer.clear();
  api.fetchServer.mockReset();
  api.runLifecycleAction.mockReset();
  api.fetchStatsHistory.mockReset();

  api.fetchServer.mockResolvedValue({ success: true, data: LAEUFT, error: null });
  // Der Verlauf interessiert hier nicht; ein abgebrochener Aufruf erzeugt
  // bewusst keinen Fehlerzustand in `useApiResource`.
  api.fetchStatsHistory.mockResolvedValue({
    success: false,
    data: null,
    error: { code: 'REQUEST_ABORTED', message: 'Die Anfrage wurde abgebrochen.' },
  });
});

describe('ServerDetail – Live und REST (event-flow-04)', () => {
  it('lässt den Live-Status gegen die beim Laden geholten REST-Daten gewinnen', async () => {
    zeichne();
    expect(await screen.findByText('Online')).toBeTruthy();

    sende(statusFrame('stopped'));

    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('zeigt nach „Starten" den jüngeren REST-Stand statt der alten Live-Meldung', async () => {
    api.runLifecycleAction.mockResolvedValue({
      success: true,
      data: mitStatus('starting'),
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    // Der Kanal meldet „gestoppt" – jünger als das geladene DTO, gewinnt also.
    sende(statusFrame('stopped'));
    await screen.findByText('Offline');

    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));

    await waitFor(() => {
      expect(api.runLifecycleAction).toHaveBeenCalledWith('srv-1', 'start', {});
    });

    // Ohne den Abgleich bliebe hier „Offline" stehen: Der Live-Status von
    // vorhin würde die frische Antwort weiter überschreiben.
    expect((await screen.findAllByText('Startet …')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('nimmt danach wieder den Live-Status an, sobald ein neues Ereignis kommt', async () => {
    api.runLifecycleAction.mockResolvedValue({
      success: true,
      data: mitStatus('starting'),
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    sende(statusFrame('stopped'));
    await screen.findByText('Offline');

    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));
    await screen.findAllByText('Startet …');

    sende(statusFrame('running'));

    expect(await screen.findByText('Online')).toBeTruthy();
  });
});

/**
 * Aktualisieren (Fundpunkt 190, geändert im Review 2026-09-16, Pflichtenheft §9).
 *
 * Ein Server behält seine Image-Version, bis der Besitzer sie übernimmt – auch
 * über Neustarts hinweg. „Aktualisieren" ist deshalb ein eigener Aufruf und
 * steht am laufenden wie am gestoppten Server.
 */
describe('ServerDetail – Aktualisieren (Pflichtenheft §9)', () => {
  const MIT_UPDATE: GameServerDto = { ...LAEUFT, updateAvailable: true };

  it('fragt am laufenden Server nach und ruft dann den eigenen Aufruf, nicht den Neustart', async () => {
    api.fetchServer.mockResolvedValue({ success: true, data: MIT_UPDATE, error: null });
    api.updateServerImage.mockResolvedValue({
      success: true,
      data: { ...MIT_UPDATE, status: 'starting', updateAvailable: false },
      error: null,
    });

    zeichne();
    fireEvent.click(await screen.findByRole('button', { name: 'Aktualisieren' }));

    // Erst die Rückfrage – ein Klick darf keine Spielrunde beenden.
    expect(await screen.findByText('Auf die neue Version aktualisieren?')).toBeTruthy();
    expect(api.updateServerImage).not.toHaveBeenCalled();

    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Aktualisieren' }),
    );

    await waitFor(() => expect(api.updateServerImage).toHaveBeenCalledWith('srv-1'));
    expect(api.runLifecycleAction).not.toHaveBeenCalled();
    expect(await screen.findByText(/wird auf die neue Version gebracht/)).toBeTruthy();
  });

  it('bietet den Knopf auch am gestoppten Server an – der nächste Start übernimmt nichts von allein', async () => {
    api.fetchServer.mockResolvedValue({
      success: true,
      data: { ...MIT_UPDATE, status: 'stopped' },
      error: null,
    });
    api.updateServerImage.mockResolvedValue({
      success: true,
      data: { ...MIT_UPDATE, status: 'stopped', updateAvailable: false },
      error: null,
    });

    zeichne();
    expect(await screen.findByText('Update verfügbar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Aktualisieren' }),
    );

    await waitFor(() => expect(api.updateServerImage).toHaveBeenCalledWith('srv-1'));
    expect(await screen.findByText(/beim nächsten Start auf der neuen Version/)).toBeTruthy();
    expect(screen.queryByText('Update verfügbar')).toBeNull();
  });

  it('bietet den Knopf ohne neue Version gar nicht an', async () => {
    zeichne();
    await screen.findByText('Online');

    expect(screen.queryByText('Update verfügbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aktualisieren' })).toBeNull();
  });

  it('bietet den Knopf ohne canUpdate nicht an', async () => {
    api.fetchServer.mockResolvedValue({
      success: true,
      data: { ...MIT_UPDATE, permissions: { ...MIT_UPDATE.permissions, canUpdate: false } },
      error: null,
    });

    zeichne();
    expect(await screen.findByText('Update verfügbar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aktualisieren' })).toBeNull();
  });
});

/**
 * Nicht jeder Spielserver nimmt Befehle entgegen: Valheim liest weder seine
 * Standardeingabe noch spricht es RCON.
 *
 * **Das Fenster bleibt trotzdem** (Wunsch des Betreibers, 2026-09-11). Die
 * Ausgabe ist bei so einem Server die einzige Stelle, an der man beim
 * Hochlaufen zusehen kann; gesperrt wird allein die Eingabe. Ein Feld, das
 * Zeilen annimmt, die nirgends ankommen, waere schlimmer als ein graues.
 */
describe('Live-Konsole bei einem Spiel ohne Konsole', () => {
  const MIT_RECHT = serverFixture({
    id: 'srv-1',
    name: 'Welt',
    status: 'running',
    permissions: ownerPermissions(),
  });

  it('zeigt sie bei einem Spiel mit Konsole', async () => {
    api.fetchServer.mockResolvedValue({ success: true, data: MIT_RECHT, error: null });

    zeichne();

    expect(await screen.findByLabelText('Konsolenbefehl')).toBeTruthy();
  });

  it('zeigt die Ausgabe auch ohne Konsole, sperrt aber die Eingabe', async () => {
    api.fetchServer.mockResolvedValue({
      success: true,
      data: { ...MIT_RECHT, supportsConsole: false },
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    // Das Fenster ist da - die Ausgabe des Containers laeuft weiter.
    expect(screen.getByRole('log', { name: 'Konsolenausgabe' })).toBeTruthy();

    const feld = screen.getByLabelText('Konsolenbefehl');
    expect(feld.hasAttribute('disabled')).toBe(true);
    // Und es steht dabei, warum - sonst haelt es jemand fuer eine Stoerung.
    expect(feld.getAttribute('placeholder')).toMatch(/keine Befehle entgegen/u);
    expect(screen.getByRole('button', { name: 'Senden' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/kennt keine Serverkonsole/u)).toBeTruthy();
  });

  it('bietet auch keine Schnellbefehle an, die ins Leere gingen', async () => {
    api.fetchServer.mockResolvedValue({
      success: true,
      data: {
        ...MIT_RECHT,
        supportsConsole: false,
        consoleQuickCommands: [{ label: 'Spieler', command: 'list' }],
      },
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    expect(screen.queryByRole('button', { name: 'Spieler' })).toBeNull();
  });
});

/**
 * Datensatz nach einem Zustandswechsel (Fundpunkt 314).
 *
 * Der Live-Kanal traegt nur `status` und `statusMessage`. Alles andere im DTO
 * - `lastStartedAt`, `totalUptimeSeconds`, `dockerContainerId` - bleibt sonst
 * auf dem Stand des ersten Abrufs, und die Laufzeit-Uhr zaehlt nach einem
 * fremden Start weiter von gestern.
 */
describe('ServerDetail - Datensatz nach einem Zustandswechsel', () => {
  it('holt den Server neu, wenn der Live-Kanal einen Wechsel meldet', async () => {
    /*
     * Der Live-Kanal traegt nur `status` und `statusMessage`; alles andere im
     * DTO bliebe auf dem Stand des ersten Abrufs stehen. Fuer die Laufzeit-Uhr
     * heisst das: Wird der Server anderswo gestartet - zweites Fenster,
     * Mitverwalter, oder nach dem automatischen Abschalten -, zaehlt sie hier
     * weiter vom alten `lastStartedAt`. Im Betrieb gesehen: "19 h 08 min" fuer
     * eine Sitzung, die seit dreizehn Minuten lief.
     */
    api.fetchServer.mockResolvedValue({ success: true, data: LAEUFT, error: null });

    zeichne();
    await screen.findByText('Online');

    const abrufeVorher = api.fetchServer.mock.calls.length;

    sende(statusFrame('stopped'));

    await waitFor(() => {
      expect(api.fetchServer.mock.calls.length).toBeGreaterThan(abrufeVorher);
    });
  });

  it('holt ohne Meldung des Kanals nichts nach', async () => {
    // Ausgeloest wird der Abruf allein von einer Meldung. Bleibt der Kanal
    // still, bleibt es beim einen Abruf des Aufbaus - kein Takt, kein Polling.
    api.fetchServer.mockResolvedValue({ success: true, data: LAEUFT, error: null });

    zeichne();
    await screen.findByText('Online');

    const abrufeVorher = api.fetchServer.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(api.fetchServer.mock.calls.length).toBe(abrufeVorher);
  });
});

describe('ServerDetail - Uhr am laufenden Uebergang', () => {
  it('zaehlt ab dem Zustandswechsel, nicht ab dem letzten Start', async () => {
    /*
     * `lastStartedAt` ist der letzte ERFOLGREICHE Start; waehrend des Startens
     * steht dort der Start von vorhin. Die Uhr zaehlte von dort und meldete
     * "Startet ... seit 105:07 min" fuer einen Server, der seit zwei Minuten
     * hochfaehrt (im Betrieb gesehen, 15.09.2026).
     */
    const jetzt = new Date('2026-09-15T12:00:00.000Z');
    vi.setSystemTime(jetzt);

    api.fetchServer.mockResolvedValue({
      success: true,
      data: {
        ...mitStatus('starting'),
        // Vor zwei Stunden lief er zuletzt, seit zwei Minuten faehrt er hoch.
        lastStartedAt: '2026-09-15T10:00:00.000Z',
        statusChangedAt: '2026-09-15T11:58:00.000Z',
      },
      error: null,
    });

    zeichne();

    expect(await screen.findByText(/seit 2:00 min/)).toBeTruthy();

    vi.useRealTimers();
  });
});

describe('ServerDetail - Messwerte ohne Live-Kanal (Fundpunkt 206/207)', () => {
  /**
   * Frisch gemessen: Die Kacheln nehmen nur Werte aus der letzten Stunde -
   * eine aeltere Messung waere eine andere Aussage als "so sieht es jetzt aus".
   */
  const MESSUNG = {
    cpuPercent: 250,
    ramUsedMb: 2048,
    diskUsedMb: 10_240,
    pingMs: 24,
    playersOnline: 3,
    playersMax: 20,
    networkRxBytes: 1024,
    networkTxBytes: 2048,
    updatedAt: new Date().toISOString(),
  };

  /** Dieselbe Messung, nur drei Stunden alt. */
  const ALTE_MESSUNG = {
    ...MESSUNG,
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  };

  it('nimmt die letzte Messung aus dem Verlauf, wenn der Kanal schweigt', async () => {
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, samples: [MESSUNG] },
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    // 2048 MiB vom gebuchten Kontingent - vorher stand hier ein Strich. Der
    // Bezugswert steht seit der Angleichung an hafenmeister in derselben Zeile.
    // Wert und Bezug stehen seit dem Entwurfs-Stil in zwei Elementen: die Zahl
    // gross, die Einheit klein daneben.
    // Zahl und Einheit stehen seit dem Entwurfs-Stil in zwei Elementen.
    expect(await screen.findByText('2,15')).toBeTruthy();
    expect(screen.getAllByText('GB').length).toBeGreaterThan(0);
    /*
     * 250 % eines Kerns sind 2,5 ausgelastete Kerne. Kennt der Eintrag die
     * Kerne der Node nicht (die Attrappe liefert sie nicht), bleibt es bei der
     * Kernzahl - lieber unschaerfer als ein erfundener Nenner.
     */
    expect(screen.getByText('2,5 Kerne')).toBeTruthy();
    expect(screen.getByText(/Keine laufenden Messwerte/)).toBeTruthy();
  });

  it('sagt beim laufenden Server ohne jede Messung nicht, er laufe nicht', async () => {
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, samples: [] },
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    expect(
      await screen.findByText(/In der letzten Stunde hat dieser Server keine Messwerte/),
    ).toBeTruthy();
    expect(screen.queryByText('Der Server läuft nicht.')).toBeNull();
  });

  it('nimmt eine drei Stunden alte Messung nicht in die Kacheln', async () => {
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, samples: [ALTE_MESSUNG] },
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    expect(
      await screen.findByText(/In der letzten Stunde hat dieser Server keine Messwerte/),
    ).toBeTruthy();
    expect(screen.queryByText('2,5 von 2 Kernen')).toBeNull();
  });

  it('bleibt beim gestoppten Server bei der alten Auskunft', async () => {
    api.fetchServer.mockResolvedValue({ success: true, data: mitStatus('stopped'), error: null });
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, samples: [MESSUNG] },
      error: null,
    });

    zeichne();
    await screen.findByText('Offline');

    /*
     * Die Messung von vorhin gehoert nicht in die Kacheln eines Servers, der
     * gerade nicht laeuft - sie saehe aus wie der aktuelle Zustand. Sichtbar
     * wird das an der Laufzeit-Kachel und daran, dass der Hinweis auf die
     * letzte festgehaltene Messung ausbleibt.
     */
    expect((await screen.findAllByText('Server läuft nicht')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Keine laufenden Messwerte/)).toBeNull();
  });
});

/**
 * Loeschen, wenn die Node nicht antwortet (Fundpunkt 226).
 *
 * Vorher endete der Versuch mit einer Fehlermeldung und der Dialog schloss sich
 * - der Server blieb dauerhaft stehen, samt belegter Subdomain und belegtem
 * Port. Jetzt bleibt der Dialog offen und bietet den zweiten Weg an.
 */
describe('ServerDetail - Loeschen ohne Node (Fundpunkt 226)', () => {
  async function bisZumLoeschdialog() {
    zeichne();
    await screen.findByText('Online');

    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/bestätigen/), {
      target: { value: LAEUFT.name },
    });

    return dialog;
  }

  it('bleibt offen und erklaert den zweiten Weg', async () => {
    api.deleteServer.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'AGENT_NOT_CONNECTED', message: 'Die Node ist nicht verbunden.' },
    });

    const dialog = await bisZumLoeschdialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Endgültig löschen' }));

    expect(await screen.findByRole('button', { name: 'Trotzdem löschen' })).toBeTruthy();
    expect(screen.getByText(/Container bleibt auf der Node liegen/)).toBeTruthy();
  });

  it('schickt beim zweiten Klick die erzwungene Loeschung', async () => {
    api.deleteServer
      .mockResolvedValueOnce({
        success: false,
        data: null,
        error: { code: 'AGENT_NOT_CONNECTED', message: 'Die Node ist nicht verbunden.' },
      })
      .mockResolvedValueOnce({ success: true, data: null, error: null });

    const dialog = await bisZumLoeschdialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Endgültig löschen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem löschen' }));

    await waitFor(() => {
      expect(api.deleteServer).toHaveBeenLastCalledWith('srv-1', { erzwingen: true });
    });
  });

  it('bietet den zweiten Weg nicht bei jedem Fehler an', async () => {
    api.deleteServer.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'SERVER_STATE_CONFLICT', message: 'Der Server wird gerade angelegt.' },
    });

    const dialog = await bisZumLoeschdialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Trotzdem löschen' })).toBeNull();
    });
  });
});
