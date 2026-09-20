import { type GameTypeDto } from '@palantir/contracts';

/**
 * Vorlagen der Templates-Seite, nach Variantengruppe zusammengefasst
 * (Betreiber-Wunsch 20.09.2026).
 *
 * **Warum.** Minecraft belegte fünf von zwanzig Karten – Paper, Vanilla,
 * Fabric, NeoForge und Bedrock –, und jede wollte Symbol und Kachelbild
 * einzeln hochgeladen bekommen. Dasselbe Bild fünfmal auszuwählen ist keine
 * Entscheidung, sondern Arbeit.
 *
 * **Was die Gruppe nicht tut.** Sie fasst die **Schalter** nicht zusammen. Ob
 * eine Instanz Paper anbietet und Bedrock nicht, bleibt eine Entscheidung je
 * Ausgabe – die Karte trägt deshalb weiterhin einen Schalter je Variante.
 * Gemeinsam ist nur, was ohnehin gemeinsam ist: der Name und die Bilder.
 *
 * Gruppiert wird nach demselben `variantGroup` wie im Anlegen-Wizard
 * (`wizardSteps.ts`), damit beide Seiten dieselbe Vorstellung davon haben, was
 * zusammengehört.
 */
export interface TemplateGroup {
  /** Schlüssel für die Liste; bei einer Gruppe deren Name, sonst die Kennung. */
  key: string;
  /** Überschrift der Karte: der Gruppenname oder der Name des Spiels. */
  label: string;
  /** Die Vorlagen dahinter, in der Reihenfolge der Registry. */
  games: GameTypeDto[];
}

/**
 * Vorlagen zu Karten zusammenfassen.
 *
 * Die Stelle einer Gruppe ist die ihres ersten Mitglieds, damit sich die
 * Reihenfolge der Registry nicht verschiebt.
 *
 * **Eine Gruppe mit einem Mitglied bleibt eine gewöhnliche Karte.** Anders als
 * im Wizard kann das hier auch dauerhaft so sein – die Templates-Seite zeigt
 * **alle** Vorlagen, auch abgeschaltete, es fällt also nichts durch einen
 * Filter weg. Bliebe sie trotzdem eine Gruppe, trüge die Karte „Minecraft" und
 * darunter stünde ein einziger Schalter ohne erkennbaren Bezug.
 */
export function buildTemplateGroups(games: readonly GameTypeDto[]): TemplateGroup[] {
  const karten: TemplateGroup[] = [];
  const gruppen = new Map<string, TemplateGroup>();

  for (const game of games) {
    const gruppe = game.variantGroup ?? null;

    if (gruppe === null || gruppe === '') {
      karten.push({ key: game.id, label: game.name, games: [game] });
      continue;
    }

    const vorhanden = gruppen.get(gruppe);

    if (vorhanden === undefined) {
      const neu: TemplateGroup = { key: gruppe, label: gruppe, games: [game] };
      gruppen.set(gruppe, neu);
      karten.push(neu);
      continue;
    }

    vorhanden.games.push(game);
  }

  return karten.map((karte) =>
    karte.games.length === 1 && karte.games[0] !== undefined
      ? { key: karte.games[0].id, label: karte.games[0].name, games: karte.games }
      : karte,
  );
}

/**
 * Beschriftung einer Variante innerhalb ihrer Gruppe, z. B. `Paper`.
 *
 * Fehlt `variantLabel`, bleibt der vollständige Anzeigename: eine Zeile, die zu
 * lang ist, ist besser als eine leere.
 */
export function templateVariantLabel(game: GameTypeDto): string {
  const label = game.variantLabel ?? null;

  return label === null || label === '' ? game.name : label;
}

/**
 * Teilen sich alle Varianten einer Karte dasselbe Image?
 *
 * **Warum das die Anzeige entscheidet.** Die vier Java-Ausgaben laufen aus
 * `palantir-game-minecraft` – eine Version unter den Schaltern sagt dort alles.
 * Bedrock hat ein eigenes (`palantir-game-minecraftbedrock`), und seit es in
 * derselben Gruppe steht, behauptete die Karte dessen Version einfach mit: Sie
 * nahm die der ersten Variante, und das war die der Java-Familie.
 *
 * Eine Zahl, die für vier Vorlagen stimmt und für die fünfte nicht, ist
 * schlimmer als fünf Zahlen – man sieht ihr nicht an, dass sie falsch ist.
 * Darum: eine gemeinsame Zeile nur, wenn es wirklich eine gemeinsame Version
 * gibt, sonst je Variante.
 */
export function teilenSichDieVersion(games: readonly GameTypeDto[]): boolean {
  const versionen = new Set(games.map((spiel) => spiel.imageVersion ?? null));

  return versionen.size === 1;
}
