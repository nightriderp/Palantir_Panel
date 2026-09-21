/**
 * Baut den Demo-Zustand auf, den das Video zeigt.
 *
 * Alles entsteht über die echte API: Konten registrieren sich, ein Admin
 * schaltet sie frei, Server werden angelegt und gestartet, Sicherungen laufen
 * über den Agent-Weg. Es wird nichts direkt in die Datenbank geschrieben –
 * was im Video zu sehen ist, hat das Panel auch wirklich so erzeugt.
 *
 * **Zwei Konten mit verschiedenen Aufgaben.** Der Owner (`chef`) kommt vor der
 * Kamera nie vor; er existiert nur, weil irgendwer die übrigen Konten
 * freischalten muss. Gefilmt wird `mika` – ein Konto mit der Rolle „Nutzer",
 * also genau die Sicht, die die Runde auf das Panel hat. Wer mit Owner-Rechten
 * filmt, zeigt eine Seitenleiste voller Administrationspunkte, die außer dem
 * Betreiber niemand je sieht.
 *
 * Der Lauf ist wiederholbar: Was es schon gibt, wird übersprungen.
 */

import { PanelClient } from './api.mjs';

const API = process.env.DEMO_API ?? 'http://127.0.0.1:4000';
const STEUER = process.env.DEMO_STEUER ?? 'http://127.0.0.1:4500';
const DOMAIN = process.env.PALANTIR_DOMAIN ?? 'palantir.example';
/** Schaltet frei und wird nie gefilmt. */
const OWNER = { username: 'chef', password: 'Palantir-Demo-2026!', name: 'Chef' };

/** Das Konto vor der Kamera – ein Nutzer wie jeder andere in der Runde. */
export const HELD = { username: 'mika', password: 'Palantir-Demo-2026!', name: 'Mika' };

/** Die Runde, die im Video zu sehen ist. */
const FREUNDE = [
  { username: 'mika', name: 'Mika', rolle: 'Nutzer' },
  { username: 'jonas', name: 'Jonas', rolle: 'Nutzer' },
  { username: 'lena', name: 'Lena', rolle: 'Nutzer' },
  { username: 'tim', name: 'Tim', rolle: 'Nutzer' },
];

const SERVER = [
  {
    name: 'Freundeskreis SMP',
    gameType: 'minecraft-paper',
    subdomain: 'smp',
    ramMb: 6144,
    config: { eula: true, maxPlayers: 20, motd: 'Freundeskreis SMP' },
    starten: true,
    spieler: ['Mika', 'Jonas', 'Lena'],
  },
  {
    name: 'Creative Bauwelt',
    gameType: 'minecraft-fabric',
    subdomain: 'creative',
    ramMb: 4096,
    config: { eula: true, maxPlayers: 20, motd: 'Creative Bauwelt' },
    starten: true,
    spieler: ['Tim'],
  },
  {
    name: 'Valheim Abende',
    gameType: 'valheim',
    subdomain: 'valheim',
    ramMb: 4096,
    config: {},
    starten: false,
    spieler: [],
  },
  {
    name: 'Terraria Runde',
    gameType: 'terraria',
    subdomain: 'terraria',
    ramMb: 2048,
    config: {},
    starten: false,
    spieler: [],
  },
];

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function steuere(pfad) {
  try {
    await fetch(`${STEUER}${pfad}`);
  } catch {
    console.warn('Demo-Node antwortet nicht – läuft sie?');
  }
}

async function main() {
  const owner = new PanelClient(API);
  await owner.anmelden(OWNER.username, OWNER.password);
  const sitzung = await owner.sitzung();
  console.log(`Freischaltung über ${sitzung.account?.displayName ?? OWNER.name}.`);

  // --- Konten ---------------------------------------------------------------
  const rollen = await owner.ruf('GET', '/admin/roles');
  const rolleNach = (name) => rollen.find((r) => r.name === name)?.id;

  /*
   * Erst nachsehen, wer schon da ist. Eine zweite Registrierung desselben
   * Namens liefe sonst in die Anmeldebremse (`AUTH_RATE_LIMITED`) statt in ein
   * sauberes „gibt es schon" – der Aufbau bräche beim zweiten Lauf ab.
   */
  const bekannt = new Set();
  for (const stand of ['approved', 'pending', 'blocked']) {
    const antwort = await owner.ruf('GET', `/admin/requests?status=${stand}`).catch(() => []);
    for (const eintrag of antwort.items ?? antwort) bekannt.add(eintrag.username);
  }

  for (const freund of FREUNDE) {
    if (bekannt.has(freund.username)) {
      console.log(`Vorhanden: ${freund.name}`);
      continue;
    }

    const gast = new PanelClient(API);
    try {
      await gast.registrieren(freund.username, 'Palantir-Demo-2026!', freund.name);
      console.log(`Registriert: ${freund.name}`);
    } catch (fehler) {
      if (!String(fehler.message).includes('USERNAME_TAKEN')) throw fehler;
      console.log(`Vorhanden: ${freund.name}`);
      continue;
    }

    if (freund.rolle !== null) {
      const offen = await owner.ruf('GET', '/admin/requests?status=pending');
      const eintrag = (offen.items ?? offen).find((a) => a.username === freund.username);
      if (eintrag) {
        const rolleId = rolleNach(freund.rolle);
        await owner.ruf('POST', `/admin/requests/${eintrag.id ?? eintrag.userId}/approve`, {
          ...(rolleId === undefined ? {} : { roleIds: [rolleId] }),
        });
        console.log(`Freigeschaltet: ${freund.name} als ${freund.rolle}`);
      }
    }
  }

  // --- Ab hier spielt der Held --------------------------------------------
  //
  // Die Server gehören dem gefilmten Konto, nicht dem Owner. Sonst stünde im
  // Video „Besitzer: Chef" an jedem Server, den angeblich Mika angelegt hat.
  const held = new PanelClient(API);
  await held.anmelden(HELD.username, HELD.password);
  console.log(`Vor der Kamera: ${HELD.name}.`);

  // Die Node-Liste ist Verwaltungswissen; sie kommt weiter vom Owner.
  const nodes = await owner.ruf('GET', '/admin/nodes');
  const hostId = nodes[0].id;
  const vorhanden = await held.ruf('GET', '/api/servers');
  const liste = vorhanden.items ?? vorhanden;

  for (const wunsch of SERVER) {
    let server = liste.find((s) => s.name === wunsch.name);

    if (!server) {
      server = await held.ruf('POST', '/api/servers', {
        gameType: wunsch.gameType,
        name: wunsch.name,
        subdomain: wunsch.subdomain,
        hostId,
        resourceLimits: { ramMb: wunsch.ramMb },
        config: wunsch.config,
        startupParameters: '',
        autoShutdownEnabled: true,
        worldImport: null,
      });
      console.log(`Angelegt: ${wunsch.name}`);
      // Das Anlegen läuft im Hintergrund weiter (Antwort kommt sofort mit
      // `creating`); erst danach lässt sich starten.
      for (let i = 0; i < 20; i += 1) {
        await warte(1_000);
        const stand = await held.ruf('GET', `/api/servers/${server.id}`);
        if (stand.status !== 'creating') break;
      }
    } else {
      console.log(`Vorhanden: ${wunsch.name}`);
    }

    if (wunsch.spieler.length > 0) {
      /*
       * Der Hostname kommt aus dem Panel selbst; eine zweite Quelle für
       * dieselbe Angabe läuft irgendwann auseinander. Ohne gesetztes
       * `PALANTIR_DOMAIN` stünde hier der Platzhalter aus der Vorlage, und
       * die Spielabfrage antwortete für einen Namen, den niemand fragt.
       */
      const stand = await held.ruf('GET', `/api/servers/${server.id}`);
      const host = stand.address?.hostname ?? `${wunsch.subdomain}.${DOMAIN}`;
      await steuere(
        `/spieler?server=${server.id}&namen=${encodeURIComponent(wunsch.spieler.join(','))}` +
          `&host=${encodeURIComponent(host)}&motd=${encodeURIComponent(wunsch.config.motd ?? wunsch.name)}`,
      );
    }

    if (wunsch.starten) {
      const stand = await held.ruf('GET', `/api/servers/${server.id}`);
      if (stand.status !== 'running' && stand.status !== 'starting') {
        await held.ruf('POST', `/api/servers/${server.id}/start`).catch((f) => {
          console.warn(`Start von ${wunsch.name} abgelehnt: ${f.message}`);
        });
        // Die Startausgabe vollständig durchlaufen lassen, damit die Konsole
        // beim Aufschlagen der Kamera schon Inhalt hat.
        for (let i = 0; i < 8; i += 1) {
          await warte(700);
          await steuere(`/ausgabe?server=${server.id}&anzahl=2`);
        }
      }
    }
  }

  // --- Sicherungen ----------------------------------------------------------
  const nachher = await held.ruf('GET', '/api/servers');
  const smp = (nachher.items ?? nachher).find((s) => s.name === 'Freundeskreis SMP');
  if (smp) {
    const bestand = await held.ruf('GET', `/servers/${smp.id}/backups`).catch(() => []);
    if ((bestand.items ?? bestand).length < 2) {
      for (let i = 0; i < 2; i += 1) {
        await held
          .ruf('POST', `/servers/${smp.id}/backups`, { stopServer: false })
          .then(() => console.log('Sicherung angestoßen.'))
          .catch((f) => console.warn(`Sicherung abgelehnt: ${f.message}`));
        await warte(3_000);
      }
    }
  }

  await mitverwalter(owner, held);
  await bestenlisten();
  await nachrichten(held);

  console.log('\nBühne steht.');
}

/**
 * Ein paar Ergebnisse in die Bestenlisten der Arcade.
 *
 * Ohne sie steht unter jeder Spielkachel „Noch niemand hat gespielt." und in
 * der Kopfzeile „Bestleistung: 0" – die Seite sieht dann aus wie ein Teil,
 * den niemand benutzt. Die Runde spielt aber; das gehört ins Bild.
 *
 * Gemeldet wird über denselben Weg wie aus dem Spiel heraus: Das Backend ist
 * die Stelle, die den Punktestand hält (eine Bestenliste nur im Browser wäre
 * keine). Jede Person meldet ihre eigenen Ergebnisse – ein Eintrag unter
 * fremdem Namen ließe sich so gar nicht erzeugen.
 *
 * Mika steht bewusst nicht überall oben: Eine Bestenliste, in der das
 * gefilmte Konto jeden Platz eins hält, wirkt gestellt.
 */
async function bestenlisten() {
  const ergebnisse = [
    { konto: 'mika', werte: { kriechpfad: 1_480, blockstapel: 6_200, punktejaeger: 3_150 } },
    { konto: 'jonas', werte: { kriechpfad: 2_010, ballwechsel: 14, steinbrecher: 4_480 } },
    { konto: 'lena', werte: { blockstapel: 9_350, punktejaeger: 2_620, ballwechsel: 9 } },
    { konto: 'tim', werte: { steinbrecher: 2_940, kriechpfad: 860 } },
  ];

  for (const eintrag of ergebnisse) {
    const client = new PanelClient(API);
    await client.anmelden(eintrag.konto, HELD.password);
    for (const [gameId, score] of Object.entries(eintrag.werte)) {
      await client
        .ruf('POST', '/arcade/scores', { gameId, score })
        .catch((f) => console.warn(`Ergebnis abgelehnt (${gameId}): ${f.message}`));
    }
    console.log(`Ergebnisse gemeldet: ${eintrag.konto}`);
  }
}

/**
 * Zugriffe auf den **Nebenservern** vergeben.
 *
 * Zwei Gründe, und beide hängen zusammen:
 *
 * 1. Das Panel gibt als Empfänger einer Direktnachricht nur Konten heraus,
 *    mit denen man ohnehin einen Server teilt – bewusst kein globales
 *    Nutzerverzeichnis (`/api/chat/recipients`). Ohne gemeinsamen Server
 *    könnten Mika und Lena einander gar nicht schreiben, und die
 *    Nachrichtenseite bliebe leer.
 * 2. Der „Freundeskreis SMP" bleibt trotzdem frei: Dort trägt die Szene
 *    „09-teilen" den ersten Mitverwalter vor laufender Kamera ein, und eine
 *    Liste, in der schon jemand steht, erzählt etwas anderes.
 *
 * Vergeben wird vom Besitzer der jeweiligen Server – das ist der Held selbst.
 */
async function mitverwalter(owner, held) {
  const konten = await owner.ruf('GET', '/admin/requests?status=approved').catch(() => []);
  const nach = (name) =>
    (konten.items ?? konten).find((k) => k.username === name)?.userId ??
    (konten.items ?? konten).find((k) => k.username === name)?.id;

  const server = await held.ruf('GET', '/api/servers');
  const finde = (name) => (server.items ?? server).find((s) => s.name === name);

  const wuensche = [
    { server: 'Creative Bauwelt', konto: 'lena', stufe: 'operator' },
    { server: 'Terraria Runde', konto: 'jonas', stufe: 'operator' },
    { server: 'Valheim Abende', konto: 'tim', stufe: 'viewer' },
  ];

  for (const wunsch of wuensche) {
    const ziel = finde(wunsch.server);
    const userId = nach(wunsch.konto);
    if (ziel === undefined || userId === undefined) {
      console.warn(`Zugriff übersprungen: ${wunsch.konto} auf ${wunsch.server}`);
      continue;
    }
    await held
      .ruf('PUT', `/api/servers/${ziel.id}/members`, { userId, level: wunsch.stufe })
      .then(() => console.log(`Zugriff: ${wunsch.konto} auf ${wunsch.server} (${wunsch.stufe})`))
      .catch((f) => console.warn(`Zugriff abgelehnt: ${f.message}`));
  }
}

/**
 * Ein paar Direktnachrichten, damit die Seite etwas zu zeigen hat.
 *
 * **Warum Direktnachrichten und nicht der Server-Chat.** Der Gruppen-Chat
 * eines Servers hat als Teilnehmerkreis dessen Mitglieder – und die
 * Zugriffsliste des SMP ist vor der Aufnahme bewusst leer (die Szene
 * „09-teilen" trägt den ersten Eintrag selbst ein). Dort könnte nur Mika
 * schreiben, und ein Verlauf, in dem eine Person mit sich selbst spricht, ist
 * keine Runde. Eine Direktnachricht braucht keine Mitgliedschaft.
 *
 * Geschrieben wird von beiden Seiten: Jede Person meldet sich mit ihrem
 * eigenen Konto an und schickt ihre eigenen Zeilen. Alles andere stünde im
 * Verlauf unter dem falschen Namen.
 */
async function nachrichten(held) {
  const wer = await held.ruf('GET', '/api/chat/recipients').catch(() => []);
  const liste = wer.items ?? wer;

  /*
   * Der Eintrag trägt `recipientId` und `displayName` – einen Anmeldenamen
   * gibt er nicht heraus. Für die Anmeldung des Gegenübers steht er deshalb
   * hier im Verlauf.
   */
  const verlaeufe = [
    {
      name: 'Jonas',
      konto: 'jonas',
      zeilen: [
        ['mika', 'Server läuft wieder, du kannst rauf'],
        ['ihn', 'top. lag das an der ram-grenze?'],
        ['mika', 'jep, 6 GB reichen jetzt'],
        ['ihn', 'und die kiste am spawn?'],
        ['mika', 'aus der sicherung von gestern zurückgeholt'],
      ],
    },
    {
      name: 'Lena',
      konto: 'lena',
      zeilen: [
        ['ihn', 'kannst du mir rechte auf dem smp geben?'],
        ['mika', 'mach ich – starten und stoppen reicht dir?'],
        ['ihn', 'perfekt, danke'],
      ],
    },
  ];

  for (const verlauf of verlaeufe) {
    const empfaenger = liste.find((k) => k.displayName === verlauf.name);
    if (empfaenger === undefined) {
      console.warn(`Kein Empfänger „${verlauf.name}" – Verlauf übersprungen.`);
      continue;
    }

    const unterhaltung = await held
      .ruf('POST', '/api/chat/conversations/direct', { recipientId: empfaenger.recipientId })
      .catch((f) => {
        console.warn(`Unterhaltung mit ${verlauf.name} abgelehnt: ${f.message}`);
        return null;
      });
    if (unterhaltung === null) continue;

    // Schon bespielt? Dann nicht ein zweites Mal – sonst steht dasselbe
    // Gespräch beim nächsten Lauf doppelt da.
    const bestand = await held
      .ruf('GET', `/api/chat/conversations/${unterhaltung.id}/messages`)
      .catch(() => ({ messages: [] }));
    if ((bestand.messages ?? []).length > 0) {
      console.log(`Vorhanden: Verlauf mit ${verlauf.name}`);
      continue;
    }

    const gegenueber = new PanelClient(API);
    await gegenueber.anmelden(verlauf.konto, HELD.password);

    for (const [absender, text] of verlauf.zeilen) {
      const client = absender === 'mika' ? held : gegenueber;
      await client
        .ruf('POST', `/api/chat/conversations/${unterhaltung.id}/messages`, { content: text })
        .catch((f) => console.warn(`Nachricht abgelehnt: ${f.message}`));
      await warte(250);
    }
    console.log(`Verlauf angelegt: ${verlauf.name}`);
  }
}

main().catch((fehler) => {
  console.error('Aufbau abgebrochen:', fehler.message);
  process.exit(1);
});
