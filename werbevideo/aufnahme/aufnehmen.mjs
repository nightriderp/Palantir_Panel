/**
 * Die Szenen des Videos.
 *
 * Jede Szene ist ein eigener Clip und für sich wiederholbar:
 *
 *     node aufnahme/aufnehmen.mjs                 # alle
 *     node aufnahme/aufnehmen.mjs 05-starten      # nur diese
 *
 * Gezeigt wird ausschließlich, was das Panel wirklich tut. Wo eine Szene
 * einen bestimmten Ausgangszustand braucht (ein Server muss aus sein, ein
 * Konto darf noch nicht freigeschaltet sein), stellt sie ihn **vor** der
 * Aufnahme über die API her – nicht während.
 */

import ffmpeg from 'ffmpeg-static';
import { Regie } from './regie.mjs';
import { PanelClient } from '../buehne/api.mjs';

const API = 'http://127.0.0.1:4000';
const KONTO = { name: 'mika', passwort: 'Palantir-Demo-2026!' };
const DOMAIN = process.env.PALANTIR_DOMAIN ?? 'palantir.example';

/** Der Server, den das Video anlegt und startet. */
const NEUER = { name: 'Survival 2026', adresse: 'survival' };

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
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  async warteAufZustand(id, zustaende, frist = 60_000) {
    const ende = Date.now() + frist;
    while (Date.now() < ende) {
      const stand = await this.client.ruf('GET', `/api/servers/${id}`);
      if (zustaende.includes(stand.status)) return stand;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(`Server ${id} erreichte ${zustaende.join('/')} nicht rechtzeitig.`);
  }

  /** Stellt sicher, dass es den Server gibt und er **aus** ist. */
  async bereitZumStarten() {
    let server = await this.finde(NEUER.name);
    if (server === null) {
      const nodes = await this.client.ruf('GET', '/admin/nodes');
      server = await this.client.ruf('POST', '/api/servers', {
        gameType: 'minecraft-paper',
        name: NEUER.name,
        subdomain: NEUER.adresse,
        hostId: nodes[0].id,
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
   * Sorgt dafür, dass jemand auf Freischaltung wartet.
   *
   * Die Admin-Szene schaltet ein Konto frei – danach ist es freigeschaltet,
   * und beim nächsten Lauf stünde die Seite leer da. Rückgängig machen lässt
   * sich eine Freigabe nicht (und soll es auch nicht), also meldet sich für
   * den nächsten Lauf die nächste Person aus der Warteliste an.
   */
  async offeneAnfrage() {
    const offen = await this.client.ruf('GET', '/admin/requests?status=pending');
    const wartend = (offen.items ?? offen)[0];
    if (wartend) return { name: wartend.displayName ?? wartend.username };

    const bekannt = new Set();
    for (const stand of ['approved', 'pending', 'blocked']) {
      const antwort = await this.client
        .ruf('GET', `/admin/requests?status=${stand}`)
        .catch(() => []);
      for (const eintrag of antwort.items ?? antwort) bekannt.add(eintrag.username);
    }

    const warteliste = [
      { username: 'nina', name: 'Nina' },
      { username: 'theo', name: 'Theo' },
      { username: 'pia', name: 'Pia' },
      { username: 'ben', name: 'Ben' },
      { username: 'juli', name: 'Juli' },
    ];
    const naechste = warteliste.find((p) => !bekannt.has(p.username));
    if (!naechste) {
      throw new Error(
        'Niemand wartet mehr auf Freischaltung und die Warteliste ist aufgebraucht. ' +
          'Bühne neu aufsetzen: werbevideo/buehne/zuruecksetzen.sh',
      );
    }

    const gast = new PanelClient(API);
    await gast.registrieren(naechste.username, 'Palantir-Demo-2026!', naechste.name);
    return { name: naechste.name };
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
      await r.gehe('/login', { warteAuf: 'text=Steuere deine Server.' });
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
        {
          ein: 900,
          stand: 2_600,
          aus: 700,
        },
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
      await r.gehe('/login', { warteAuf: 'text=Willkommen zurück' });
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
      await r.halten(2_600);
      await r.abblenden(500);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '03-uebersicht',
    async lauf(r) {
      await r.gehe('/servers', { warteAuf: 'text=Freundeskreis SMP' });
      await r.aufblenden(600);
      await r.untertitelEin('Alle Server auf einer Seite.');
      await r.halten(1_400);
      await r.untertitelAus();

      await r.kamera({ auf: 'text=Freundeskreis SMP', zoom: 1.5, dauer: 1_500 });
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
      await r.halten(3_500);
      await r.zeigerAus();
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '05-starten',
    async vorbereiten(buehne) {
      const server = await buehne.bereitZumStarten();
      return { serverId: server.id };
    },
    async lauf(r, { serverId }) {
      await r.gehe(`/servers/${serverId}`, { warteAuf: `text=${NEUER.name}` });
      await r.aufblenden(600);
      await r.untertitelEin('Ein Klick.');
      await r.klicke('button:has-text("Starten")', { nach: 0 });
      await r.untertitelAus(260);

      // Der Homeserver arbeitet – und die Konsole erzählt davon. Die Zeilen
      // kommen über den Live-Kanal, freigegeben im Takt des Schnitts.
      await r
        .kamera({ auf: '.font-mono, pre, [class*="konsole"]', zoom: 1.3, dauer: 1_400 })
        .catch(async () => {
          await r.kamera({ zoom: 1.25, dauer: 1_400 });
        });
      await r.untertitelEin('Der Homeserver zieht das Image und startet den Container.');
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
      await r.untertitelEin('Läuft.');
      await r.halten(1_600);
      await r.untertitelAus();

      // Jetzt verbinden sich die Ersten. Die Spielerzahl im Panel stammt aus
      // der echten Abfrage des Spielservers – die Demo-Node beantwortet sie
      // auf dem Spielport, das Backend fragt sie von sich aus ab.
      await r.buehne(
        `/spieler?server=${serverId}&namen=Mika,Jonas&host=${NEUER.adresse}.${DOMAIN}` +
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
      await r.halten(3_200);
      await r.untertitelAus();

      await r.kamera({ auf: `text=${NEUER.adresse}.${DOMAIN}`, zoom: 1.8, dauer: 1_100 });
      await r.untertitelEin('Diese Adresse bekommen die Freunde – sonst nichts.');
      await r
        .klicke(`button:has-text("${NEUER.adresse}.${DOMAIN}")`, { nach: 1_200 })
        .catch(async () => {
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
      const server = await buehne.finde('Freundeskreis SMP');
      return { serverId: server.id };
    },
    async lauf(r, { serverId }) {
      await r.gehe(`/servers/${serverId}`, { warteAuf: 'text=Freundeskreis SMP' });
      await r.aufblenden(600);

      // Die Konsole steht weit unten auf der Seite – erst hinrollen.
      await r.scrolleZu('text=console —', { dauer: 900, abstand: 120 });
      await r.kamera({ zoom: 1.15, dauer: 1_000 });
      await r.untertitelEin('Die Konsole des Servers – im Browser, ohne SSH.');
      await r.halten(1_600);
      await r.untertitelAus();

      /*
       * Erst leeren, dann füllen: So ist im Bild zu sehen, dass die Zeilen
       * wirklich über den Live-Kanal ankommen, statt schon dazustehen. Jede
       * Zeile geht durch dieselbe Kette wie im Betrieb – Agent, Backend,
       * WebSocket, Browser.
       */
      await r.klicke('button:has-text("Leeren")', { nach: 500 });

      const abend = [
        'Done (6.913s)! For help, type "help"',
        'Mika joined the game',
        'Jonas joined the game',
        'Lena joined the game',
        '<Jonas> moin',
        '<Lena> wer hat die kiste am spawn geplündert',
        '<Mika> ich war das nicht',
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

      await r.tippe(
        r.seite.getByPlaceholder('Befehl eingeben …'),
        'say Runde startet in 5 Minuten',
      );
      await r.klicke('button:has-text("Senden")', { nach: 400 });
      await r.halten(1_800);
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
      const server = await buehne.finde('Freundeskreis SMP');
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
      await r.untertitelEin('Und die Node selbst: was läuft, was noch frei ist.');
      await r.halten(2_600);
      await r.untertitelAus();
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '08-backups',
    async vorbereiten(buehne) {
      const server = await buehne.finde('Freundeskreis SMP');
      return { serverId: server.id };
    },
    async lauf(r, { serverId }) {
      await r.gehe(`/servers/${serverId}`, { warteAuf: 'text=Freundeskreis SMP' });
      await r.aufblenden(500);
      await r.klicke('[role="tab"]:has-text("Backups")', { nach: 1_400 });
      await r.untertitelEin('Sicherungen: auf Knopfdruck oder nach Zeitplan.');
      await r.halten(1_600);
      await r.untertitelAus();

      await r.klicke('button:has-text("Jetzt sichern")', { nach: 0 });
      await r.halten(4_000);
      /*
       * „Unklar" an einer Sicherung heißt im Panel nicht „Prüfsumme fehlt",
       * sondern „im laufenden Betrieb gezogen" – gegenüber „Vollständig" bei
       * angehaltenem Server. Der Untertitel sagt genau das; vorher stand hier
       * eine Aussage über Prüfsummen, die das Bild nicht zeigt.
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
      await r.abblenden(600);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '09-admin',
    async vorbereiten(buehne) {
      return buehne.offeneAnfrage();
    },
    async lauf(r, { name }) {
      await r.gehe('/admin/requests', { warteAuf: 'text=Registrierungen' });
      await r.aufblenden(600);
      await r.untertitelEin('Wer mitspielen will, fragt an.');
      await r.kamera({ zoom: 1.25, dauer: 1_200 });
      await r.markiere(r.seite.getByText(name, { exact: true }).first().locator('xpath=../..'));
      await r.halten(1_600);
      await r.untertitelAus();
      await r.markierungAus();

      await r.klicke(r.seite.getByRole('button', { name: /Freigeben/ }).first(), { nach: 900 });
      await r.untertitelEin('Ohne weitere Auswahl bekommt das Konto die Standardrolle.');
      await r.halten(1_800);
      await r.untertitelAus();

      // Der Dialog ist der zweite Schritt – vorher ist nichts freigeschaltet.
      await r.klicke(r.seite.getByRole('dialog').getByRole('button', { name: 'Freigeben' }), {
        nach: 2_000,
      });
      await r.untertitelEin('Freigeschaltet.');
      await r.halten(1_500);
      await r.untertitelAus();
      await r.zeigerAus();
      await r.kamera({ zoom: 1, dauer: 800 });

      await r.gehe('/admin/roles', { warteAuf: 'text=Rollen' });
      await r.untertitelEin('Rollen entscheiden, wer was darf – Schalter für Schalter.');
      await r.kamera({ zoom: 1.2, dauer: 1_300 });
      await r.halten(2_200);
      await r.untertitelAus();
      await r.kamera({ zoom: 1, dauer: 700 });

      await r.gehe('/admin/audit', { warteAuf: 'text=Audit-Log' });
      await r.untertitelEin('Und im Protokoll steht, wer was getan hat.');
      await r.kamera({ zoom: 1.3, dauer: 1_400 });
      await r.halten(2_200);
      await r.untertitelAus();
      await r.kamera({ zoom: 1, dauer: 800 });
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
    name: '11-luecke',
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
    name: '10-abspann',
    async lauf(r) {
      await r.gehe('/servers', { warteAuf: 'text=Freundeskreis SMP' });
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

  try {
    await r.anmelden(KONTO.name, KONTO.passwort);

    for (const szene of liste) {
      const mitgabe = szene.vorbereiten ? await szene.vorbereiten(buehne) : {};
      if (szene.abgemeldet === true) await r.abmelden();

      await r.szene(szene.name);
      try {
        await szene.lauf(r, mitgabe ?? {});
      } catch (fehler) {
        // Ein Bild vom Moment des Abbruchs: Ohne das rät man beim nächsten
        // Lauf, welcher Knopf ausgegraut war oder welche Meldung im Weg stand.
        const beleg = `${r.ziel}/abbruch-${szene.name}.png`;
        await r.seite.screenshot({ path: beleg }).catch(() => {});
        console.error(`\nAbbruch in „${szene.name}" – Bildschirm liegt in ${beleg}`);
        throw fehler;
      }
      await r.schnitt();

      // Die Anmeldeszenen lassen den Browser in einem anderen Zustand zurück,
      // als die folgenden ihn brauchen.
      if (szene.abgemeldet === true) await r.anmelden(KONTO.name, KONTO.passwort);
    }
  } finally {
    await r.schliessen();
  }

  console.log('\n\nFertige Clips:');
  for (const clip of r.geschrieben) {
    console.log(`  ${clip.name}  ${(clip.bilder / 30).toFixed(1)} s`);
  }
}

main().catch((fehler) => {
  console.error('\nAufnahme abgebrochen:', fehler.message);
  process.exit(1);
});
