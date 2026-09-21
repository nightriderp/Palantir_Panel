/**
 * Die Szenen der Aufnahmefassung – die erste der drei Fassungen.
 *
 * Jede Szene ist ein eigener Clip und für sich wiederholbar:
 *
 *     node aufnahme/aufnehmen.mjs                 # alle
 *     node aufnahme/aufnehmen.mjs 05-starten      # nur diese
 *
 * Gezeigt wird ausschließlich, was das Panel wirklich tut. Wo eine Szene
 * einen bestimmten Ausgangszustand braucht (ein Server muss aus sein, ein
 * Mitverwalter darf noch nicht eingetragen sein), stellt sie ihn **vor** der
 * Aufnahme über die API her – nicht während.
 *
 * ---
 *
 * **Gefilmt wird ein Konto mit der Rolle „Nutzer".** Kein Owner, kein Admin.
 * Die Administrationsseiten (Registrierungen freigeben, Rollen, Audit-Log,
 * Node-Verwaltung) kommen deshalb nirgends vor: Sie sieht außer dem Betreiber
 * nie jemand, und ein Werbevideo, das mit Owner-Rechten gedreht ist, zeigt
 * eine Oberfläche, die es für die Zuschauer gar nicht gibt.
 *
 * **Der Ton.** Frech in den Zwischentexten, nüchtern in der Sache. Die Regel
 * ist dieselbe wie bei den Theme-Sprüchen des Panels (`lib/theme/sprueche.ts`):
 * Ein Scherz steht nur dort, wo ein Missverständnis nichts kostet. Kein
 * Untertitel behauptet etwas, das im selben Bild nicht zu sehen ist.
 */

import ffmpeg from 'ffmpeg-static';
import { Regie } from './regie.mjs';
import { PanelClient } from '../buehne/api.mjs';

const API = 'http://127.0.0.1:4000';
const KONTO = { name: 'mika', passwort: 'Palantir-Demo-2026!' };

/** Der Server, den das Video anlegt und startet. */
const NEUER = { name: 'Survival 2026', adresse: 'survival' };

/** Der Server, an dem Konsole, Messwerte und Sicherungen gezeigt werden. */
const STAMM = 'Freundeskreis SMP';

/** Wer in der Szene „Teilen" Zugriff bekommt. */
const MITVERWALTER = { username: 'jonas', name: 'Jonas' };

// ---------------------------------------------------------------------------
// Bühnenhilfe: Zustand herstellen, bevor die Kamera läuft
// ---------------------------------------------------------------------------

const STEUER = process.env.DEMO_STEUER ?? 'http://127.0.0.1:4500';

/** Die Demo-Node steuern, bevor die Kamera läuft. */
async function steuere(pfad) {
  await fetch(`${STEUER}${pfad}`).catch(() => {
    console.warn('Demo-Node antwortet nicht – läuft sie?');
  });
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

class Buehne {
  static async oeffnen() {
    const b = new Buehne();
    b.client = new PanelClient(API);
    await b.client.anmelden(KONTO.name, KONTO.passwort);
    return b;
  }

  async server() {
    const antwort = await this.client.ruf('GET', '/api/servers');
    return antwort.items ?? antwort;
  }

  async finde(name) {
    return (await this.server()).find((s) => s.name === name) ?? null;
  }

  /** Wie {@link finde}, bricht aber ab, statt `null` weiterzureichen. */
  async brauche(name) {
    const server = await this.finde(name);
    if (server === null) {
      throw new Error(
        `Server „${name}" fehlt. Die Bühne ist nicht aufgebaut: node buehne/daten.mjs`,
      );
    }
    return server;
  }

  /** Server samt Adresse loswerden – der Aufnahmelauf soll bei null anfangen. */
  async entferne(name) {
    const server = await this.finde(name);
    if (server === null) return;
    if (server.status === 'running' || server.status === 'starting') {
      await this.client.ruf('POST', `/api/servers/${server.id}/stop`).catch(() => {});
      await this.warteAufZustand(server.id, ['stopped', 'error'], 40_000);
    }
    await this.client.ruf('DELETE', `/api/servers/${server.id}`).catch(() => {});
    for (let i = 0; i < 30; i += 1) {
      if ((await this.finde(name)) === null) return;
      await warte(1_000);
    }
  }

  async warteAufZustand(id, zustaende, frist = 60_000) {
    const ende = Date.now() + frist;
    while (Date.now() < ende) {
      const stand = await this.client.ruf('GET', `/api/servers/${id}`);
      if (zustaende.includes(stand.status)) return stand;
      await warte(1_000);
    }
    throw new Error(`Server ${id} erreichte ${zustaende.join('/')} nicht rechtzeitig.`);
  }

  /** Stellt sicher, dass es den Server gibt und er **aus** ist. */
  async bereitZumStarten() {
    let server = await this.finde(NEUER.name);
    if (server === null) {
      /*
       * Die Nutzersicht auf die Nodes, nicht `/admin/nodes`: Das gefilmte
       * Konto hat die Rolle „Nutzer", und genau diesen Pfad ruft auch der
       * Assistent im Panel auf (`fetchHostNodes`). Bewusst ohne `/api`.
       */
      const nodes = await this.client.ruf('GET', '/nodes/available').catch(() => null);
      const hostId = (nodes?.items ?? nodes ?? [])[0]?.id;
      if (hostId === undefined) {
        throw new Error('Keine Node sichtbar – läuft das Backend mit aufgebauter Bühne?');
      }
      server = await this.client.ruf('POST', '/api/servers', {
        gameType: 'minecraft-paper',
        name: NEUER.name,
        subdomain: NEUER.adresse,
        hostId,
        resourceLimits: { ramMb: 4096 },
        config: { eula: true, maxPlayers: 20, motd: 'Survival 2026' },
        startupParameters: '',
        autoShutdownEnabled: true,
        worldImport: null,
      });
      server = await this.warteAufZustand(server.id, ['stopped', 'error']);
    }
    if (server.status === 'running' || server.status === 'starting') {
      await this.client.ruf('POST', `/api/servers/${server.id}/stop`).catch(() => {});
      server = await this.warteAufZustand(server.id, ['stopped', 'error'], 40_000);
    }
    return server;
  }

  /**
   * Den Mitverwalter wieder austragen, damit die Szene ihn eintragen kann.
   *
   * Beim zweiten Lauf stünde er sonst schon in der Liste, die Auswahl „Konto"
   * wäre leer und die Szene klickte ins Nichts. Rückgängig gemacht wird das
   * über denselben Weg, den die Oberfläche nimmt – nicht in der Datenbank.
   */
  async ohneMitverwalter(serverId) {
    const liste = await this.client.ruf('GET', `/api/servers/${serverId}/members`).catch(() => []);
    for (const eintrag of liste.items ?? liste) {
      const wer = eintrag.username ?? eintrag.user?.username;
      if (wer !== MITVERWALTER.username) continue;
      const id = eintrag.userId ?? eintrag.user?.id ?? eintrag.id;
      await this.client.ruf('DELETE', `/api/servers/${serverId}/members/${id}`).catch(() => {});
    }
  }

  /**
   * Geplante Aufgaben abräumen.
   *
   * Dieselbe Überlegung wie oben: Die Szene legt eine Aufgabe an, und eine
   * Liste, in der sie schon dreimal steht, erzählt etwas anderes als „so legt
   * man eine an".
   */
  async ohneAufgaben(serverId) {
    const liste = await this.client
      .ruf('GET', `/api/servers/${serverId}/schedules`)
      .catch(() => []);
    for (const aufgabe of liste.items ?? liste) {
      await this.client
        .ruf('DELETE', `/api/servers/${serverId}/schedules/${aufgabe.id}`)
        .catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Szenen
// ---------------------------------------------------------------------------

const SZENEN = [
  // -------------------------------------------------------------------------
  {
    name: '01-vorspann',
    abgemeldet: true,
    async lauf(r) {
      await r.gehe('/login', { warteAuf: 'text=Palantir' });
      // Bewusst ohne Ziel: eine mittige Rückfahrt. Auf die Schlagzeile am
      // linken Rand gerichtet, schiebt die Randbegrenzung sie aus dem Bild.
      await r.kameraSetzen({ zoom: 1.18 });
      await r.aufblenden(900);
      // Eine ganz langsame Rückfahrt: Das Bild beruhigt sich, während der
      // Titel steht.
      await r.kameraFahrtStarten({ zoom: 1, dauer: 6_000 });
      await r.titelkarte(
        'Palantir',
        'Gameserver für den Freundeskreis – auf eurem eigenen Rechner.',
        { ein: 900, stand: 2_600, aus: 700 },
      );
      await r.halten(1_800);
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '02-anmelden',
    abgemeldet: true,
    async lauf(r) {
      await r.gehe('/login', { warteAuf: 'form' });
      await r.aufblenden(600);
      await r.kamera({ auf: 'form', zoom: 1.35, dauer: 1_200 });
      await r.untertitelEin('Anmelden – mehr Einrichtung braucht die Runde nicht.');
      // Über die Beschriftung angesprochen, nicht über Klassennamen: Das
      // Panel darf sein Markup ändern, ohne dass die Aufnahme kaputtgeht.
      await r.tippe(r.seite.getByLabel('Benutzername'), KONTO.name);
      await r.tippe(r.seite.getByLabel('Passwort', { exact: true }), KONTO.passwort, {
        proZeichen: 45,
      });
      await r.untertitelAus();

      await r.untertitelEin('Der Spam-Schutz rechnet selbst – ohne fremden Dienst.');
      await r.halten(1_400);
      await r.untertitelAus();

      // Erst klicken, dann zurückfahren. Andersherum wandert der Knopf
      // während der Zeigerbewegung aus dem Bild – die Klickstelle wird vor
      // der Fahrt bestimmt, der echte Klick fällt danach ins Leere.
      await r.klicke('button:has-text("Anmelden")', { nach: 0 });
      await r.kameraFahrtStarten({ zoom: 1, dauer: 1_400 });
      await r.zeigerAus(400);
      await r.halten(2_400);
      await r.stoss({ staerke: 0.05 });
      await r.halten(700);
      await r.abblenden(500);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '03-uebersicht',
    async lauf(r) {
      await r.gehe('/servers', { warteAuf: `text=${STAMM}` });
      await r.aufblenden(600);
      await r.schlagwort('Vier Server.|Eine Seite.', { stand: 1_100 });
      await r.halten(400);

      await r.kamera({ auf: `text=${STAMM}`, zoom: 1.5, dauer: 1_500 });
      await r.untertitelEin('Last, Ping und Spielerzahl kommen live vom Homeserver.');
      await r.halten(2_200);
      await r.untertitelAus();

      await r.kamera({ auf: 'text=GESAMTSTATUS', zoom: 1.45, dauer: 1_400 });
      await r.untertitelEin('Oben steht, wie es der ganzen Installation geht.');
      await r.halten(2_000);
      await r.untertitelAus();

      await r.kamera({ zoom: 1, dauer: 1_100 });
      await r.halten(500);
      await r.abblenden(500);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '04-erstellen',
    async vorbereiten(buehne) {
      await buehne.entferne(NEUER.name);
    },
    async lauf(r) {
      await r.gehe('/servers/neu', { warteAuf: 'text=Wähle dein Spiel' });
      await r.aufblenden(600);
      await r.untertitelEin('Neuer Server: erst das Spiel.');
      await r.klicke('button:has-text("Minecraft")', { nach: 400 });
      await r.untertitelAus();
      await r.klicke('button:has-text("Weiter")', { nach: 600 });

      await r.untertitelEin('Dann Name und Adresse.');
      await r.tippe(r.seite.getByLabel('Servername'), NEUER.name);
      await r.tippe(r.seite.getByLabel('Adresse'), NEUER.adresse);
      await r.halten(500);
      await r.untertitelAus();

      // Ohne gewählte Node bleibt „Weiter" ausgegraut – das Panel lässt
      // keinen Server ohne Ziel anlegen.
      await r.untertitelEin('Und auf welcher Node er laufen soll.');
      await r.waehle(r.seite.getByLabel('Node'), { index: 1 });
      await r.halten(600);
      await r.untertitelAus();
      await r.klicke('button:has-text("Weiter")', { nach: 700 });

      await r.untertitelEin('Optionen – so viele oder so wenige, wie du willst.');
      await r.halten(1_600);
      await r.untertitelAus();

      // Ohne Zustimmung zur Lizenz von Mojang startet kein Minecraft-Server;
      // das Panel lässt den Schritt deshalb nicht überspringen.
      await r.untertitelEin('Die Lizenz von Mojang bestätigen – ohne sie startet kein Server.');
      // Über die Beschriftung angesprochen trifft der Klick den Schalter,
      // nicht den Text daneben.
      await r.klicke(r.seite.getByLabel('EULA von Mojang angenommen'), { nach: 600 });
      await r.untertitelAus();

      await r.scrolleZu('button:has-text("Weiter")', { dauer: 800 });
      await r.klicke('button:has-text("Weiter")', { nach: 700 });

      await r.untertitelEin('Noch einmal alles nachlesen.');
      await r.halten(1_600);
      await r.untertitelAus();
      await r.klicke('button:has-text("Server erstellen")', { nach: 0 });
      await r.halten(2_600);
      await r.zeigerAus();
      await r.stoss({ staerke: 0.055 });
      await r.schlagwort('Kein Ticket.|Kein Warten.', { stand: 1_200 });
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '05-starten',
    async vorbereiten(buehne) {
      const server = await buehne.bereitZumStarten();
      /*
       * Die Adresse kommt aus dem Panel, nicht aus einer Umgebungsvariablen.
       * Ein Aufnahmelauf ohne gesetztes `PALANTIR_DOMAIN` suchte sonst nach
       * dem Platzhalter aus der Vorlage, während im Bild längst die echte
       * Domain stand – und brach mitten in der Szene ab.
       */
      return { serverId: server.id, adresse: server.address?.hostname ?? null };
    },
    async lauf(r, { serverId, adresse }) {
      await r.gehe(`/servers/${serverId}`, { warteAuf: `text=${NEUER.name}` });
      await r.aufblenden(600);
      await r.untertitelEin('Ein Klick.');
      await r.klicke('button:has-text("Starten")', { nach: 0 });
      await r.untertitelAus(260);
      await r.stoss({ staerke: 0.05 });

      // Der Homeserver arbeitet – und die Konsole erzählt davon. Die Zeilen
      // kommen über den Live-Kanal, freigegeben im Takt des Schnitts.
      await r
        .kamera({ auf: '.font-mono, pre, [class*="konsole"]', zoom: 1.3, dauer: 1_400 })
        .catch(async () => {
          await r.kamera({ zoom: 1.25, dauer: 1_400 });
        });
      await r.untertitelEin('Kein Ladebalken. Die echte Ausgabe des Servers.');
      for (let i = 0; i < 6; i += 1) {
        await r.buehne(`/ausgabe?server=${serverId}&anzahl=2`);
        await r.halten(520);
      }
      await r.untertitelAus();

      await r.untertitelEin('Fertig ist er, wenn er auf Spieler antwortet – nicht vorher.');
      for (let i = 0; i < 4; i += 1) {
        await r.buehne(`/ausgabe?server=${serverId}&anzahl=1`);
        await r.halten(620);
      }
      await r.untertitelAus();

      await r.kamera({ auf: 'text=Online', zoom: 1.8, dauer: 1_200 });
      await r.blitz({ hoehe: 0.55 });
      await r.schlagwort('Läuft.', { stand: 900, groesse: 132 });

      // Jetzt verbinden sich die Ersten. Die Spielerzahl im Panel stammt aus
      // der echten Abfrage des Spielservers – die Demo-Node beantwortet sie
      // auf dem Spielport, das Backend fragt sie von sich aus ab.
      await r.buehne(
        `/spieler?server=${serverId}&namen=Mika,Jonas&host=${encodeURIComponent(adresse ?? '')}` +
          `&motd=${encodeURIComponent(NEUER.name)}`,
      );
      await r.kamera({ auf: 'text=Spieler', zoom: 1.6, dauer: 1_100 });
      await r.buehne(
        `/zeile?server=${serverId}&text=${encodeURIComponent('Mika joined the game')}`,
      );
      await r.halten(1_400);
      await r.buehne(
        `/zeile?server=${serverId}&text=${encodeURIComponent('Jonas joined the game')}`,
      );
      await r.untertitelEin('Und die Ersten sind drin.');
      await r.halten(3_000);
      await r.untertitelAus();

      await r.kamera({ auf: `text=${adresse}`, zoom: 1.8, dauer: 1_100 });
      await r.untertitelEin('Diese Adresse bekommen die Freunde – sonst nichts.');
      await r.klicke(`button:has-text("${adresse}")`, { nach: 1_200 }).catch(async () => {
        await r.halten(1_400);
      });
      await r.untertitelAus();
      await r.zeigerAus();
      await r.kamera({ zoom: 1, dauer: 900 });
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '06-konsole',
    async vorbereiten(buehne) {
      const server = await buehne.brauche(STAMM);
      return { serverId: server.id };
    },
    async lauf(r, { serverId }) {
      await r.gehe(`/servers/${serverId}`, { warteAuf: `text=${STAMM}` });
      await r.aufblenden(600);

      // Die Konsole steht weit unten auf der Seite – erst hinrollen.
      await r.scrolleZu('text=console —', { dauer: 900, abstand: 120 });
      await r.kamera({ zoom: 1.15, dauer: 1_000 });
      await r.untertitelEin('Die Konsole des Servers – im Browser. SSH bleibt heute zu.');
      await r.halten(1_800);
      await r.untertitelAus();

      /*
       * Erst leeren, dann füllen: So ist im Bild zu sehen, dass die Zeilen
       * wirklich über den Live-Kanal ankommen, statt schon dazustehen. Jede
       * Zeile geht durch dieselbe Kette wie im Betrieb – Agent, Backend,
       * WebSocket, Browser.
       */
      await r.klicke('button:has-text("Leeren")', { nach: 500 });

      // Ein Abend auf dem Server. Der Wortwechsel ist der Scherz – die
      // Technik darunter ist keiner.
      const abend = [
        'Done (6.913s)! For help, type "help"',
        'Mika joined the game',
        'Jonas joined the game',
        'Lena joined the game',
        '<Jonas> moin',
        '<Lena> wer hat die kiste am spawn geplündert',
        '<Mika> ich war das nicht',
        '<Jonas> die kiste war schon leer als ich kam',
        '<Lena> das ist ein geständnis',
      ];
      for (const zeile of abend) {
        await r.buehne(`/zeile?server=${serverId}&text=${encodeURIComponent(zeile)}`);
        await r.halten(360);
      }
      await r.untertitelEin('Alles, was der Server sagt – in dem Moment, in dem er es sagt.');
      await r.halten(1_900);
      await r.untertitelAus();

      // Die Schnellbefehle liegen unter dem Ausgabefenster.
      await r.scrolleZu('button:has-text("Senden")', { dauer: 800, abstand: 620 });
      // Die Antwort kommt aus dem echten Befehlsweg (EXEC_CONSOLE), nicht
      // aus einer eingeschobenen Zeile.
      await r.klicke(r.seite.getByRole('button', { name: 'Spieler', exact: true }), { nach: 800 });
      await r.untertitelEin('Schnellbefehle für das, was man ständig braucht.');
      await r.halten(2_000);
      await r.untertitelAus();

      /*
       * Über die Vorlesebeschriftung angesprochen, nicht über den Platzhalter:
       * Der Platzhalter wechselt mit dem Zustand („Der Server läuft nicht.",
       * „Terraria nimmt keine Befehle entgegen.") – die Beschriftung nicht.
       */
      await r.tippe(
        r.seite.getByLabel('Konsolenbefehl'),
        'say Wer die Kiste geleert hat, baut sie wieder auf',
      );
      await r.klicke('button:has-text("Senden")', { nach: 400 });
      await r.halten(1_600);
      await r.untertitelEin('Jeder Befehl steht später im Protokoll – mit Namen.');
      await r.halten(1_800);
      await r.untertitelAus();
      await r.zeigerAus();
      await r.kamera({ zoom: 1, dauer: 800 });
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '07-monitoring',
    async vorbereiten(buehne) {
      const server = await buehne.brauche(STAMM);
      return { serverId: server.id };
    },
    async lauf(r, { serverId }) {
      await r.gehe(`/servers/${serverId}`, { warteAuf: 'text=CPU-Last' });
      await r.aufblenden(600);
      await r.kamera({ zoom: 1.2, dauer: 1_100 });

      /*
       * Hervorgehoben wird die **Karte**, nicht ihre Überschrift: Ein
       * `text=`-Treffer ist nur die Zeile selbst, und im Bild lag der Rahmen
       * dann über der Überschrift, während die Sache darunter abgedunkelt
       * blieb. Der Elternknoten ist die Karte.
       */
      const karte = (beschriftung) =>
        r.seite.getByText(beschriftung, { exact: true }).first().locator('xpath=..');

      await r.markiere(karte('CPU-Last'), { ein: 450 });
      await r.untertitelEin('CPU, Speicher, Ping, Spieler – jede Zahl gemessen.');
      await r.halten(2_400);
      await r.untertitelAus();
      await r.markierungAus();

      await r.markiere(karte('Verbundene Spieler'));
      await r.untertitelEin('Wer gerade spielt, steht dabei.');
      await r.halten(2_200);
      await r.untertitelAus();
      await r.markierungAus();
      await r.kamera({ zoom: 1, dauer: 800 });

      await r.gehe('/nodes', { warteAuf: 'text=Nodes online' });
      await r.untertitelEin('Und die Maschine selbst: was läuft, was noch frei ist.');
      await r.halten(2_600);
      await r.untertitelAus();
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '08-backups',
    async vorbereiten(buehne) {
      const server = await buehne.brauche(STAMM);
      return { serverId: server.id };
    },
    async lauf(r, { serverId }) {
      await r.gehe(`/servers/${serverId}`, { warteAuf: `text=${STAMM}` });
      await r.aufblenden(500);
      await r.klicke('[role="tab"]:has-text("Backups")', { nach: 1_400 });
      await r.untertitelEin('Sicherungen: auf Knopfdruck oder nach Zeitplan.');
      await r.halten(1_600);
      await r.untertitelAus();

      await r.klicke('button:has-text("Jetzt sichern")', { nach: 0 });
      await r.halten(3_600);
      /*
       * „Unklar" an einer Sicherung heißt im Panel nicht „Prüfsumme fehlt",
       * sondern „im laufenden Betrieb gezogen" – gegenüber „Vollständig" bei
       * angehaltenem Server. Der Untertitel sagt genau das.
       */
      await r.untertitelEin('Jede Sicherung hält fest, ob der Server dabei lief.');
      await r.halten(2_400);
      await r.untertitelAus();

      await r.klicke('button:has-text("Wiederherstellen")', { nach: 1_200 });
      await r.untertitelEin('Zurückspielen geht genauso schnell – mit Rückfrage.');
      await r.halten(2_200);
      await r.untertitelAus();
      // Es wird nichts zurückgespielt: Der Abbruch gehört mit ins Bild.
      await r.klicke('button:has-text("Abbrechen")', { nach: 800 }).catch(async () => {
        await r.seite.keyboard.press('Escape');
        await r.halten(800);
      });
      await r.zeigerAus();
      await r.schlagwort('Die Welt von gestern.|Eine Minute entfernt.', { stand: 1_300 });
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    /*
     * Teilen statt Passwort weitergeben.
     *
     * Das ist die Szene, die früher „Admin, Rollen und Rechte" war – nur aus
     * der richtigen Sicht. Dass ein Betreiber Rollen vergeben kann,
     * interessiert die Runde nicht; dass **Mika** einem Freund Zugriff auf
     * genau einen Server geben kann, ohne ihr Konto herzugeben, schon.
     */
    name: '09-teilen',
    async vorbereiten(buehne) {
      const server = await buehne.brauche(STAMM);
      await buehne.ohneMitverwalter(server.id);
      await buehne.ohneAufgaben(server.id);
      return { serverId: server.id };
    },
    async lauf(r, { serverId }) {
      await r.gehe(`/servers/${serverId}`, { warteAuf: `text=${STAMM}` });
      await r.aufblenden(500);
      await r.klicke('[role="tab"]:has-text("Einstellungen")', { nach: 1_200 });

      await r.scrolleZu('text=Zugriff', { dauer: 900, abstand: 160 });
      await r.untertitelEin('Ein Freund soll mithelfen – ohne dein Passwort.');
      await r.halten(1_800);
      await r.untertitelAus();

      await r.klicke('button:has-text("Mitverwalter hinzufügen")', { nach: 900 });
      /*
       * Der Eintrag heißt „Jonas (@jonas)", nicht „Jonas": Anzeigenamen sind
       * frei wählbar und nicht eindeutig, deshalb steht der Anmeldename in der
       * Klammer daneben (`MembersPanel.tsx`). Zur Sicherheit drei Anläufe –
       * der letzte nimmt einfach den ersten echten Eintrag, denn Eintrag 0 ist
       * der Platzhalter „Konto wählen …".
       */
      const dialog = r.seite.getByRole('dialog');
      const konto = dialog.getByLabel('Konto');
      await r
        .waehle(konto, { label: `${MITVERWALTER.name} (@${MITVERWALTER.username})` })
        .catch(() => r.waehle(konto, { label: MITVERWALTER.name }))
        .catch(() => r.waehle(konto, { index: 1 }));
      await r.halten(600);

      await r.untertitelEin('Drei Stufen: zusehen, bedienen, verwalten.');
      await r.waehle(dialog.getByLabel('Stufe'), { label: 'Bedienen' }).catch(async () => {
        await r.halten(600);
      });
      await r.halten(1_400);
      await r.untertitelAus();

      await r.klicke('button:has-text("Zugriff geben")', { nach: 1_600 });
      await r.stoss({ staerke: 0.045 });
      await r.untertitelEin('Jonas darf jetzt starten und stoppen. Mehr nicht.');
      await r.halten(2_200);
      await r.untertitelAus();
      await r.zeigerAus();

      /*
       * Und was der Server ganz ohne Menschen erledigt.
       *
       * Erst zurück nach oben: Die Zugriffsliste steht weit unten im Reiter
       * „Einstellungen", und die Reiterleiste liegt von dort aus außerhalb des
       * Bildes. Der Klick ging ins Leere, die Szene brach am fehlenden Knopf
       * „Neue Aufgabe" ab.
       */
      await r.scrolleZu('[role="tab"]:has-text("Aufgaben")', { dauer: 700, abstand: 220 });
      await r.klicke('[role="tab"]:has-text("Aufgaben")', { nach: 1_400 });
      await r.untertitelEin('Was regelmäßig passieren soll, macht der Server selbst.');
      await r.halten(1_600);
      await r.untertitelAus();

      await r.klicke('button:has-text("Neue Aufgabe")', { nach: 900 });
      // Die Felder im Dialog ansprechen, nicht auf der Seite: „Name" gibt es
      // im Reiter dahinter auch.
      const aufgabe = r.seite.getByRole('dialog');
      await r.tippe(aufgabe.getByLabel('Name'), 'Nächtliche Sicherung');
      await r
        .waehle(aufgabe.getByLabel('Aktion'), { label: 'Sicherung erstellen' })
        .catch(async () => {
          await r.halten(400);
        });
      await r.tippe(aufgabe.getByLabel('Zeitplan (Cron)'), '0 4 * * *', { proZeichen: 90 });
      await r.halten(600);
      await r.untertitelEin('Um vier Uhr nachts. Da ist ohnehin niemand wach.');
      await r.halten(1_800);
      await r.untertitelAus();
      await r.klicke('button:has-text("Anlegen")', { nach: 1_800 });
      await r.zeigerAus();
      await r.schlagwort('Einmal eingestellt.|Nie wieder daran denken.', { stand: 1_300 });
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    /*
     * Das Drumherum – der freche Teil.
     *
     * Nachrichten, Arcade und Erfolge sind keine Kernfunktionen, und genau
     * deshalb stehen sie hier: Sie zeigen, dass das Panel für eine Runde
     * gebaut ist und nicht für ein Rechenzentrum. Der Ton darf hier am
     * lockersten sein – es wird nichts gestartet, gestoppt oder gelöscht.
     */
    name: '10-drumherum',
    async lauf(r) {
      /*
       * Gewartet wird auf den **Untertitel** der Seite, nicht auf ihre
       * Überschrift: „Nachrichten", „Arcade" und „Erfolge" stehen auf jeder
       * Seite des Panels in der Seitenleiste. Ein Warten darauf wäre sofort
       * erfüllt – auch auf der Seite davor.
       */
      await r.gehe('/messages', { warteAuf: 'text=Direktnachrichten und Server-Chats' });
      await r.aufblenden(600);
      await r.untertitelEin('Die Runde redet im Panel – kein zweiter Dienst nötig.');
      await r.kamera({ zoom: 1.2, dauer: 1_300 });
      await r.halten(2_000);
      await r.untertitelAus();
      await r.kamera({ zoom: 1, dauer: 700 });

      await r.gehe('/arcade', { warteAuf: 'text=Kleine Spiele für zwischendurch' });
      await r.blitz({ hoehe: 0.5 });
      await r.schlagwort('Der Server startet.|Du hast 40 Sekunden.', { stand: 1_300 });

      await r.untertitelEin('Fünf Minispiele. Eigene Bestenliste. Warum? Warum nicht.');
      await r.kamera({ auf: 'text=Kriechpfad', zoom: 1.4, dauer: 1_200 }).catch(async () => {
        await r.kamera({ zoom: 1.25, dauer: 1_200 });
      });
      await r.halten(2_000);
      await r.untertitelAus();

      // Kurz wirklich spielen: Ein Standbild der Auswahlseite wäre eine
      // Behauptung, die bewegte Leinwand ist der Beleg.
      await r.klicke('button:has-text("Spielen")', { nach: 1_600 }).catch(async () => {
        await r.halten(800);
      });
      for (const taste of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) {
        await r.seite.keyboard.press(taste).catch(() => {});
        await r.halten(420);
      }
      await r.halten(900);
      await r.zeigerAus();
      await r.kamera({ zoom: 1, dauer: 700 });

      await r.gehe('/erfolge', {
        warteAuf: 'text=Abzeichen für das, was du im Panel ohnehin tust',
      });
      await r.untertitelEin('Und ja: Es gibt Erfolge fürs Hosten.');
      await r.kamera({ zoom: 1.25, dauer: 1_300 });
      await r.halten(2_200);
      await r.untertitelAus();
      await r.wackeln({ dauer: 380, staerke: 6 });
      await r.untertitelEin('Nein, das ist uns nicht peinlich.');
      await r.halten(1_800);
      await r.untertitelAus();
      await r.kamera({ zoom: 1, dauer: 700 });
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    /*
     * Die Themes.
     *
     * Der Wechsel lädt nichts nach: Alle Variablensätze stehen schon im
     * Dokument, ein Klick setzt `data-theme` um. Deshalb ist diese Szene
     * bewusst schnell geschnitten – die Umstellung braucht kein Einzelbild
     * Wartezeit, und genau das soll man sehen.
     */
    name: '11-themes',
    async lauf(r) {
      await r.gehe('/profil', { warteAuf: 'text=Erscheinungsbild' });
      await r.aufblenden(600);
      await r.scrolleZu('text=Erscheinungsbild', { dauer: 800, abstand: 140 });
      await r.untertitelEin('Wie es aussieht, entscheidet jeder für sich.');
      await r.halten(1_600);
      await r.untertitelAus();

      /*
       * Angesprochen wird die **Kachel** der Auswahl, nicht irgendein Text mit
       * diesem Wort: Auf dem Profil steht „Standard" auch anderswo, und ein
       * Treffer daneben klickte ins Leere. Die Kacheln sind die Beschriftungen
       * der Auswahlknöpfe – daran sind sie sicher zu erkennen.
       */
      const kachel = (name) =>
        r.seite.locator('label:has(input[name="erscheinungsbild"])').filter({ hasText: name });

      for (const name of ['Schmiedefeuer', 'Neonnacht', 'Kanzlei', 'Hyperraum', 'Tageslicht']) {
        await r.klicke(kachel(name), { hin: 380, nach: 620 }).catch(async () => {
          await r.halten(500);
        });
      }
      await r.zeigerAus(260);
      await r.stoss({ staerke: 0.05 });
      await r.schlagwort('Sechs Anstriche.|Kein Neuladen.', { stand: 1_200 });

      // Zurück auf Standard – die folgenden Szenen sollen aussehen wie alle
      // anderen. Ein Aufnahmelauf, der mitten in „Tageslicht" endet, färbt
      // sonst jeden späteren Clip um.
      await r.klicke(kachel('Standard'), { hin: 420, nach: 900 }).catch(async () => {
        await r.halten(500);
      });
      await r.zeigerAus();
      await r.untertitelEin('Die Farben ändern sich. Wo etwas steht, nicht.');
      await r.halten(1_900);
      await r.untertitelAus();
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    /*
     * Das Panel am Telefon.
     *
     * Aufgenommen im Hochformat eines Pixel 7 mit doppelter Bildpunktdichte;
     * in den Telefonrahmen kommt es später beim Schnitt. Deshalb hat diese
     * Szene weder Untertitel noch Kamerafahrten – beides säße sonst *im*
     * Handybildschirm und wäre im fertigen Bild winzig.
     */
    name: '12-handy',
    geraet: 'handy',
    async vorbereiten(buehne) {
      const server = await buehne.brauche(STAMM);
      // Die Konsole soll auch am Telefon etwas zu zeigen haben; nach einem
      // Neustart des Backends ist ihr Verlauf leer.
      for (const zeile of [
        'Done (6.913s)! For help, type "help"',
        'Mika joined the game',
        'Jonas joined the game',
        'Lena joined the game',
        '<Jonas> moin',
        '<Mika> bin in 5 min da',
      ]) {
        await steuere(`/zeile?server=${server.id}&text=${encodeURIComponent(zeile)}`);
        await warte(120);
      }
      return { serverId: server.id };
    },
    async lauf(r, { serverId }) {
      await r.gehe('/servers', { warteAuf: `text=${STAMM}`, beruhigen: 5_000 });
      await r.aufblenden(500);
      await r.halten(1_400);

      // Suchen statt scrollen: Am Telefon ist das der kürzere Weg – und es
      // zeigt nebenbei, dass es die Suche gibt.
      await r.tippe(r.seite.getByPlaceholder(/Server suchen/i), 'freundes', { proZeichen: 150 });

      // Erst wenn die Liste wirklich nur noch einen Server zeigt, ist der
      // erste „Verwalten"-Knopf der richtige.
      await r.warteAuf(
        () =>
          [...document.querySelectorAll('button')].filter(
            (knopf) => knopf.textContent.trim() === 'Verwalten',
          ).length === 1,
        { beschreibung: 'Suche filtert auf einen Server' },
      );
      await r.halten(900);

      await r.klicke('button:has-text("Verwalten")', { nach: 2_600 });

      // Durch die Detailseite rollen: Messwerte, Spieler, Konsole.
      await r
        .scrolleZu('text=Verbundene Spieler', { dauer: 1_100, abstand: 120 })
        .catch(async () => {
          await r.halten(600);
        });
      await r.halten(1_600);
      await r.scrolleZu('text=console —', { dauer: 1_100, abstand: 90 });
      await r.halten(1_400);

      await r.buehne(
        `/zeile?server=${serverId}&text=${encodeURIComponent('<Lena> bin gleich da')}`,
      );
      await r.halten(1_800);
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    /*
     * Der Platzhalter für euer Spielmaterial.
     *
     * Er wird hier aufgenommen und nicht im Schnitt erzeugt: Der ffmpeg-Bau
     * dieses Werkzeugs bringt keinen Textfilter mit, und die Tafel soll
     * ohnehin dieselbe Schrift tragen wie der Rest des Videos.
     */
    name: '13-luecke',
    async lauf(r) {
      await r.gehe('/servers', { warteAuf: 'text=Übersicht' });
      // Ohne das bleibt die Schwarzblende liegen – sie wird nach der
      // Titelkarte gezeichnet und deckte die Tafel vollständig ab.
      await r.aufblenden(200);
      await r.titelkarte(
        'Hier steht euer Gameplay',
        'Mitschnitt als material/gameplay.mp4 ablegen und neu schneiden.',
        { ein: 600, stand: 7_600, aus: 600, deckend: true },
      );
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '14-abspann',
    async lauf(r) {
      await r.gehe('/servers', { warteAuf: `text=${STAMM}` });
      await r.kameraSetzen({ zoom: 1.12 });
      await r.aufblenden(700);
      await r.kameraFahrtStarten({ zoom: 1.3, dauer: 6_000 });
      await r.titelkarte('Palantir', 'Selbst gehostet. Kein Anbieter, keine monatliche Rechnung.', {
        ein: 900,
        stand: 2_800,
        aus: 800,
      });
      await r.halten(1_500);
      await r.abblenden(900);
    },
  },
];

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

async function main() {
  const gewuenscht = process.argv.slice(2);
  const liste =
    gewuenscht.length === 0 ? SZENEN : SZENEN.filter((s) => gewuenscht.includes(s.name));

  if (liste.length === 0) {
    console.error(`Unbekannte Szene. Bekannt sind:\n  ${SZENEN.map((s) => s.name).join('\n  ')}`);
    process.exit(2);
  }

  const buehne = await Buehne.oeffnen();
  const r = await Regie.oeffnen({ ffmpeg });

  /**
   * Zweite Regie im Hochformat – erst beim Bedarf geöffnet.
   *
   * Ein Handy-Bild entsteht nur mit einem Handy-Ansichtsfenster: Das Panel
   * entscheidet über Medienabfragen, nicht über die Fenstergröße im Schnitt.
   * Ein herunterskaliertes Desktop-Bild wäre ein anderes Layout.
   */
  let handyRegie = null;
  const regieFuer = async (szene) => {
    if (szene.geraet !== 'handy') return r;
    if (handyRegie === null) {
      /*
       * Bewusst **ohne** Chromiums Handy-Emulation (`mobil`).
       *
       * Mit ihr wertet Chromium die Viewport-Angabe der Seite aus: Das
       * Ansichtsfenster der Seite war dann 622 statt 412 Punkte breit, während
       * das Bildschirmfoto weiter 412 Punkte breit entstand. Alles, was mit
       * Koordinaten rechnet – Kamera, Zeiger, Klickstellen –, lag daneben.
       * Das mobile Layout hängt ohnehin an der Breite, nicht an der Emulation:
       * 412 Punkte sind 412 Punkte.
       */
      handyRegie = await Regie.oeffnen({
        ffmpeg,
        breite: 412,
        hoehe: 915,
        bildskala: 2,
        zeigerArt: 'finger',
      });
      await handyRegie.anmelden(KONTO.name, KONTO.passwort);
    }
    return handyRegie;
  };

  try {
    await r.anmelden(KONTO.name, KONTO.passwort);

    for (const szene of liste) {
      const mitgabe = szene.vorbereiten ? await szene.vorbereiten(buehne) : {};
      const regie = await regieFuer(szene);
      if (szene.abgemeldet === true) await regie.abmelden();

      await regie.szene(szene.name);
      try {
        await szene.lauf(regie, mitgabe ?? {});
      } catch (fehler) {
        // Ein Bild vom Moment des Abbruchs: Ohne das rät man beim nächsten
        // Lauf, welcher Knopf ausgegraut war oder welche Meldung im Weg stand.
        const beleg = `${regie.ziel}/abbruch-${szene.name}.png`;
        await regie.seite.screenshot({ path: beleg }).catch(() => {});
        console.error(`\nAbbruch in „${szene.name}" – Bildschirm liegt in ${beleg}`);
        throw fehler;
      }
      await regie.schnitt();

      // Die Anmeldeszenen lassen den Browser in einem anderen Zustand zurück,
      // als die folgenden ihn brauchen.
      if (szene.abgemeldet === true) await regie.anmelden(KONTO.name, KONTO.passwort);
    }
  } finally {
    await r.schliessen();
    await handyRegie?.schliessen();
  }

  console.log('\n\nFertige Clips:');
  for (const clip of [...r.geschrieben, ...(handyRegie?.geschrieben ?? [])]) {
    console.log(`  ${clip.name}  ${(clip.bilder / 30).toFixed(1)} s`);
  }
}

main().catch((fehler) => {
  console.error('\nAufnahme abgebrochen:', fehler.message);
  process.exit(1);
});
