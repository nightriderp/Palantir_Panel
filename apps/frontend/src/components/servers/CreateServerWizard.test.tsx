import { type GameTypeDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { gameType } from './testFixtures';
import { CreateServerWizard } from './CreateServerWizard';

/**
 * Eine Kachel je Spiel, die Variante darunter (Betreiber-Wunsch 20.09.2026).
 *
 * Die Regeln der Gruppierung stehen als reine Funktionen daneben und sind dort
 * geprüft (`wizardSteps.test.ts`). Hier geht es um das, was nur der gerenderte
 * Schritt zeigt: dass aus vier Minecraft-Kacheln eine wird, dass die Auswahl
 * darunter erst mit der Wahl erscheint, und dass ein Wechsel den
 * Ressourcen-Vorschlag der neuen Variante mitnimmt.
 */

const api = vi.hoisted(() => ({
  fetchGameTypes: vi.fn(),
  fetchGameVersions: vi.fn(),
  fetchHostNodes: vi.fn(),
  fetchResourceQuota: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/servers/new',
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchGameTypes: api.fetchGameTypes,
  fetchGameVersions: api.fetchGameVersions,
  fetchHostNodes: api.fetchHostNodes,
  fetchResourceQuota: api.fetchResourceQuota,
}));

const PAPER: GameTypeDto = gameType({
  id: 'minecraft-paper',
  name: 'Minecraft (Paper)',
  description: 'Minecraft-Server auf Basis von Paper.',
  variantGroup: 'Minecraft',
  variantLabel: 'Paper',
  resourceDefaults: { ramMb: 2048, diskMb: 10240 },
});

const NEOFORGE: GameTypeDto = gameType({
  id: 'minecraft-neoforge',
  name: 'Minecraft (NeoForge)',
  description: 'Minecraft mit dem Mod-Loader NeoForge.',
  variantGroup: 'Minecraft',
  variantLabel: 'NeoForge',
  resourceDefaults: { ramMb: 6144, diskMb: 15360 },
});

const VALHEIM: GameTypeDto = gameType({ id: 'valheim', name: 'Valheim' });

function zeige(spiele: GameTypeDto[] = [PAPER, NEOFORGE, VALHEIM]) {
  api.fetchGameTypes.mockResolvedValue({ success: true, data: spiele });
  api.fetchGameVersions.mockResolvedValue({ success: true, data: [] });
  api.fetchHostNodes.mockResolvedValue({ success: true, data: [] });
  api.fetchResourceQuota.mockResolvedValue({ success: false, error: 'kein Kontingent' });

  return render(
    <ToastProvider>
      <CreateServerWizard />
    </ToastProvider>,
  );
}

/** Die Auswahl unter dem Kachelraster; `null`, solange es sie nicht gibt. */
function variantenfeld(): HTMLSelectElement | null {
  return screen.queryByLabelText('Variante') as HTMLSelectElement | null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateServerWizard – Spielauswahl mit Varianten', () => {
  it('zeigt eine Kachel „Minecraft" statt einer je Ausgabe', async () => {
    zeige();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Minecraft/ })).toBeTruthy();
    });

    // Der vollständige Name steht nicht mehr auf einer eigenen Kachel.
    expect(screen.queryByRole('button', { name: /Minecraft \(Paper\)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Minecraft \(NeoForge\)/ })).toBeNull();
    // Ein Spiel ohne Gruppe bleibt, wie es war.
    expect(screen.getByRole('button', { name: /Valheim/ })).toBeTruthy();
  });

  it('nennt auf der ungewählten Kachel die Zahl der Varianten', async () => {
    zeige();

    await waitFor(() => {
      expect(screen.getByText('2 Varianten')).toBeTruthy();
    });
  });

  it('bietet die Variantenwahl erst nach dem Klick auf die Kachel', async () => {
    zeige();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Minecraft/ })).toBeTruthy();
    });
    expect(variantenfeld()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Minecraft/ }));

    await waitFor(() => {
      expect(variantenfeld()).not.toBeNull();
    });
  });

  it('wählt beim Klick auf die Kachel die erste Variante vor', async () => {
    zeige();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Minecraft/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Minecraft/ }));

    await waitFor(() => {
      expect(variantenfeld()?.value).toBe('minecraft-paper');
    });
    // Die Kachel sagt jetzt, welche Ausgabe dahintersteckt – in der Auswahl
    // darunter steht derselbe Name noch einmal, deshalb nicht `getByText`.
    expect(screen.getByRole('button', { name: /Minecraft/ }).textContent?.includes('Paper')).toBe(
      true,
    );
  });

  it('zeigt zu einem Spiel ohne Gruppe keine Variantenwahl', async () => {
    zeige();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Valheim/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Valheim/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Weiter' }).hasAttribute('disabled')).toBe(false);
    });
    expect(variantenfeld()).toBeNull();
  });

  it('nimmt beim Wechsel den Ressourcen-Vorschlag der neuen Variante mit', async () => {
    // Der Grund, warum die Wahl in diesen Schritt gehört und nicht zu den
    // Optionen: NeoForge schlägt 6 GiB vor, Paper 2 GiB. Stünde sie hinter dem
    // Schritt „Grundlagen", überschriebe der Wechsel dort eingestellte Werte.
    zeige();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Minecraft/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Minecraft/ }));

    await waitFor(() => {
      expect(variantenfeld()).not.toBeNull();
    });

    const feld = variantenfeld() as HTMLSelectElement;
    fireEvent.change(feld, { target: { value: 'minecraft-neoforge' } });

    await waitFor(() => {
      expect(variantenfeld()?.value).toBe('minecraft-neoforge');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Arbeitsspeicher (MiB)') as HTMLInputElement).value).toBe(
        '6144',
      );
    });
  });

  it('lässt eine Gruppe mit nur einer freigeschalteten Ausgabe unter ihrem Namen stehen', async () => {
    // Der Administrator kann einzelne Spieltypen abschalten; abgeschaltete
    // erreichen den Wizard gar nicht erst.
    zeige([PAPER, VALHEIM]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Minecraft \(Paper\)/ })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Minecraft \(Paper\)/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Weiter' }).hasAttribute('disabled')).toBe(false);
    });
    expect(variantenfeld()).toBeNull();
  });
});
