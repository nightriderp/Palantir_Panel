import { type ArcadeGameId } from '@palantir/contracts';
import { type AnyTurnGame } from '@palantir/arcade';
import { type ComponentType } from 'react';
import { type SfxName } from '@/lib/arcade/audio/types';

/**
 * Oberfläche eines rundenbasierten Spiels.
 *
 * Die Regeln liegen in `@palantir/arcade`. Die Brett-Komponente bekommt nur die
 * **Sicht** eines Sitzes (`TurnGame.view`) und meldet Züge über `onMove`. Wer
 * den Zug anwendet – der Browser (am selben Gerät, gegen den Computer) oder der
 * Server (Online-Raum) – weiß sie nicht und muss es nicht wissen. Dadurch gibt
 * es je Spiel genau eine Oberfläche für alle drei Spielweisen.
 */

export interface TurnSeatInfo {
  index: number;
  /** „Anna", „Computer (Schwer)", „Spieler 2". */
  name: string;
  kind: 'human' | 'bot' | 'open';
  /** Farbe des Sitzes (Figur, Rahmen). Vom Wirt vergeben, einheitlich über alle Spiele. */
  color: string;
  isMe: boolean;
}

export interface TurnBoardProps<V = unknown, M = unknown> {
  /** Sicht des Sitzes `mySeat` (bzw. Zuschauersicht). */
  view: V;
  /** Sitz, aus dessen Sicht gezeichnet wird; `null` = Zuschauer. */
  mySeat: number | null;
  seats: TurnSeatInfo[];
  /** Sitze, die gerade ziehen dürfen. */
  activeSeats: number[];
  /** Darf `mySeat` jetzt ziehen? (Am Zug, kein Bot denkt gerade, nichts wird gesendet.) */
  canAct: boolean;
  /** Zug vorschlagen. Die Brett-Komponente prüft vorher, was sie kann (Hervorhebung). */
  onMove(move: M): void;
  /** Geräusch abspielen. */
  sfx(name: SfxName): void;
  /** Partie vorbei? Dann nur noch anzeigen. */
  finished: boolean;
}

export interface TurnBoardDefinition {
  readonly id: ArcadeGameId;
  /** Die Regeln aus `@palantir/arcade`. */
  readonly rules: AnyTurnGame;
  /** Brett-Komponente (lazy geladen). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Sicht und Zug je Spiel privat.
  readonly Board: ComponentType<TurnBoardProps<any, any>>;
  /** Kurze Spielanleitung (deutsch, ein Absatz oder Stichpunkte mit „•"). */
  readonly rulesText: string;
  /**
   * Optionale Einstellungs-Oberfläche vor Spielbeginn (z. B. Schiffe-Größe,
   * Monopoly-Startgeld, Codenames-Wortliste). Bekommt die aktuellen Optionen und
   * meldet geänderte zurück; geprüft wird mit `rules.parseOptions`.
   */
  readonly OptionsForm?: ComponentType<OptionsFormProps>;
}

/** Eigenschaften der Einstellungs-Oberfläche eines Spiels. */
export interface OptionsFormProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Optionen je Spiel privat.
  value: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Optionen je Spiel privat.
  onChange(value: any): void;
  seatCount: number;
}
