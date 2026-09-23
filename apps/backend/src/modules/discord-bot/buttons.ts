/**
 * Knöpfe unter der Status-Kachel (F4, F8, F10, F11; Pflichtenheft §14a.5).
 *
 * Reine Logik: Kennungen bauen und lesen, entscheiden, welche Knöpfe im
 * aktuellen Zustand ausgegraut sind, und die Knopfleiste als Discord-Komponenten
 * darstellen. Ob der Klickende etwas **darf**, entscheidet diese Datei nicht –
 * das prüft der Handler bei jedem Klick gegen die Rechte des Panels.
 *
 * **Kennungen (`custom_id`, höchstens 100 Zeichen):**
 * - `srv:<serverId>:<aktion>` – der Knopf unter der Kachel
 * - `srv:<serverId>:<aktion>:ok:<unixSekunden>` – die Bestätigung dazu
 * - `srv:<serverId>:console:modal` – das Eingabefeld der Konsole
 */

import type { ServerStatus } from '@palantir/contracts';

export const SERVER_ACTIONS = ['start', 'stop', 'restart', 'backup', 'players', 'console'] as const;

export type ServerAction = (typeof SERVER_ACTIONS)[number];

/** Aktionen, die vor der Ausführung bestätigt werden müssen. */
export const CONFIRMED_ACTIONS: ReadonlySet<ServerAction> = new Set(['stop', 'restart']);

/** Wie lange eine Bestätigung gilt (Pflichtenheft §14a.5). */
export const CONFIRMATION_TTL_SECONDS = 60;

/** Name des Textfelds im Konsolen-Modal. */
export const CONSOLE_INPUT_ID = 'befehl';
export const MAX_CONSOLE_COMMAND_LENGTH = 200;

export type ParsedCustomId =
  | { readonly kind: 'action'; readonly serverId: string; readonly action: ServerAction }
  | {
      readonly kind: 'confirm';
      readonly serverId: string;
      readonly action: ServerAction;
      readonly issuedAt: number;
    }
  | { readonly kind: 'consoleModal'; readonly serverId: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MUSTER = new RegExp(`^srv:(${UUID}):([a-z]+)(?::(ok):(\\d{1,12})|:(modal))?$`);

function istAktion(wert: string): wert is ServerAction {
  return (SERVER_ACTIONS as readonly string[]).includes(wert);
}

export function actionId(serverId: string, action: ServerAction): string {
  return `srv:${serverId}:${action}`;
}

export function confirmId(serverId: string, action: ServerAction, issuedAtSeconds: number): string {
  return `srv:${serverId}:${action}:ok:${String(issuedAtSeconds)}`;
}

export function consoleModalId(serverId: string): string {
  return `srv:${serverId}:console:modal`;
}

/**
 * Liest eine Kennung. Alles, was nicht exakt dem Muster entspricht, ist
 * `null` – eine Kennung kommt zwar signiert von Discord, geschrieben hat sie
 * aber der Bot selbst, und eine fremde Form ist ein Fehler, keine Absicht.
 */
export function parseCustomId(customId: string | undefined): ParsedCustomId | null {
  const treffer = customId ? MUSTER.exec(customId) : null;

  if (!treffer) return null;

  const [, serverId, action, ok, issuedAt, modal] = treffer;

  if (!serverId || !action || !istAktion(action)) return null;

  if (modal) {
    return action === 'console' ? { kind: 'consoleModal', serverId } : null;
  }

  if (ok) {
    return CONFIRMED_ACTIONS.has(action)
      ? { kind: 'confirm', serverId, action, issuedAt: Number(issuedAt) }
      : null;
  }

  return { kind: 'action', serverId, action };
}

export function confirmationExpired(issuedAtSeconds: number, nowMs: number): boolean {
  const alter = nowMs / 1000 - issuedAtSeconds;

  return alter < -5 || alter > CONFIRMATION_TTL_SECONDS;
}

/**
 * Ist ein Knopf im Zustand sinnvoll? Die Kachel ist für alle Betrachter
 * dieselbe Nachricht; ausgegraut wird deshalb nach Zustand, nicht nach Recht.
 * Die Zustandsmaschine entscheidet beim Klick ohnehin selbst
 * (`SERVER_STATE_CONFLICT`) – das hier erspart nur den sinnlosen Klick.
 */
export function actionAvailable(action: ServerAction, status: ServerStatus): boolean {
  switch (action) {
    case 'start':
      return status === 'stopped' || status === 'crashed' || status === 'error';
    case 'stop':
      return status === 'running' || status === 'starting';
    case 'restart':
      return status === 'running';
    case 'players':
    case 'console':
      return status === 'running';
    case 'backup':
      return status !== 'creating';
  }
}

// -- Discord-Komponenten ------------------------------------------------------

/** https://discord.com/developers/docs/interactions/message-components */
export const ComponentType = { ActionRow: 1, Button: 2, TextInput: 4 } as const;
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4 } as const;
export const TextInputStyle = { Short: 1 } as const;

export interface ButtonComponent {
  readonly type: 2;
  readonly style: number;
  readonly label: string;
  readonly custom_id: string;
  readonly disabled?: boolean;
}

export interface ActionRow {
  readonly type: 1;
  readonly components: readonly ButtonComponent[];
}

const KNOEPFE: Record<ServerAction, { label: string; style: number }> = {
  start: { label: 'Starten', style: ButtonStyle.Success },
  stop: { label: 'Stoppen', style: ButtonStyle.Danger },
  restart: { label: 'Neustarten', style: ButtonStyle.Primary },
  backup: { label: 'Sicherung jetzt', style: ButtonStyle.Secondary },
  players: { label: 'Spieler', style: ButtonStyle.Secondary },
  console: { label: 'Konsole', style: ButtonStyle.Secondary },
};

function knopf(serverId: string, action: ServerAction, status: ServerStatus): ButtonComponent {
  return {
    type: ComponentType.Button,
    style: KNOEPFE[action].style,
    label: KNOEPFE[action].label,
    custom_id: actionId(serverId, action),
    disabled: !actionAvailable(action, status),
  };
}

export interface TileControls {
  readonly serverId: string;
  readonly status: ServerStatus;
  /** Konsole über Discord für diesen Server freigeschaltet (Vorgabe aus). */
  readonly consoleEnabled: boolean;
  /** Meldet das Spiel Spieler? Sonst entfällt der Knopf. */
  readonly supportsPlayers: boolean;
  /** Nimmt das Spiel Konsolenbefehle an? */
  readonly supportsConsole: boolean;
}

/** Zeile 1: Lebenszyklus. Zeile 2: Sicherung, Spieler, Konsole. */
export function renderControls(controls: TileControls): ActionRow[] {
  const { serverId, status } = controls;
  const zweite: ServerAction[] = ['backup'];

  if (controls.supportsPlayers) zweite.push('players');
  if (controls.consoleEnabled && controls.supportsConsole) zweite.push('console');

  return [
    {
      type: ComponentType.ActionRow,
      components: (['start', 'stop', 'restart'] as const).map((a) => knopf(serverId, a, status)),
    },
    { type: ComponentType.ActionRow, components: zweite.map((a) => knopf(serverId, a, status)) },
  ];
}

/** Rückfrage vor Stoppen oder Neustarten. */
export function renderConfirmation(
  serverId: string,
  action: ServerAction,
  issuedAtSeconds: number,
): ActionRow[] {
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Danger,
          label: action === 'stop' ? 'Ja, stoppen' : 'Ja, neu starten',
          custom_id: confirmId(serverId, action, issuedAtSeconds),
        },
      ],
    },
  ];
}

/** Modal mit einem Textfeld für einen einzelnen Konsolenbefehl. */
export function renderConsoleModal(serverId: string, serverName: string) {
  return {
    custom_id: consoleModalId(serverId),
    title: `Konsole: ${serverName}`.slice(0, 45),
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            custom_id: CONSOLE_INPUT_ID,
            style: TextInputStyle.Short,
            label: 'Befehl',
            required: true,
            max_length: MAX_CONSOLE_COMMAND_LENGTH,
          },
        ],
      },
    ],
  };
}
