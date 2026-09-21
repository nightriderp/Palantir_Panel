/**
 * Baut den Demo-Zustand auf, den das Video zeigt.
 *
 * Alles entsteht über die echte API: Konten registrieren sich, ein Admin
 * schaltet sie frei, Server werden angelegt und gestartet, Sicherungen laufen
 * über den Agent-Weg. Es wird nichts direkt in die Datenbank geschrieben –
 * was im Video zu sehen ist, hat das Panel auch wirklich so erzeugt.
 *
 * Der Lauf ist wiederholbar: Was es schon gibt, wird übersprungen.
 */

import { PanelClient } from './api.mjs';

const API = process.env.DEMO_API ?? 'http://127.0.0.1:4000';
const STEUER = process.env.DEMO_STEUER ?? 'http://127.0.0.1:4500';
const DOMAIN = process.env.PALANTIR_DOMAIN ?? 'palantir.example';
const OWNER = { username: 'mika', password: 'Palantir-Demo-2026!', name: 'Mika' };

/** Die Runde, die im Video zu sehen ist. */
const FREUNDE = [
  { username: 'jonas', name: 'Jonas', rolle: 'Nutzer' },
  { username: 'lena', name: 'Lena', rolle: 'Nutzer' },
  { username: 'tim', name: 'Tim', rolle: 'Moderator' },
  // Sara bleibt bewusst unfreigeschaltet: Sie ist die offene Anfrage, die im
  // Admin-Teil des Videos freigeschaltet wird.
  { username: 'sara', name: 'Sara', rolle: null },
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
  console.log(`Angemeldet als ${sitzung.account?.displayName ?? OWNER.name}.`);

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

  // --- Server ---------------------------------------------------------------
  const nodes = await owner.ruf('GET', '/admin/nodes');
  const hostId = nodes[0].id;
  const vorhanden = await owner.ruf('GET', '/api/servers');
  const liste = vorhanden.items ?? vorhanden;

  for (const wunsch of SERVER) {
    let server = liste.find((s) => s.name === wunsch.name);

    if (!server) {
      server = await owner.ruf('POST', '/api/servers', {
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
        const stand = await owner.ruf('GET', `/api/servers/${server.id}`);
        if (stand.status !== 'creating') break;
      }
    } else {
      console.log(`Vorhanden: ${wunsch.name}`);
    }

    if (wunsch.spieler.length > 0) {
      const host = `${wunsch.subdomain}.${DOMAIN}`;
      await steuere(
        `/spieler?server=${server.id}&namen=${encodeURIComponent(wunsch.spieler.join(','))}` +
          `&host=${encodeURIComponent(host)}&motd=${encodeURIComponent(wunsch.config.motd ?? wunsch.name)}`,
      );
    }

    if (wunsch.starten) {
      const stand = await owner.ruf('GET', `/api/servers/${server.id}`);
      if (stand.status !== 'running' && stand.status !== 'starting') {
        await owner.ruf('POST', `/api/servers/${server.id}/start`).catch((f) => {
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
  const nachher = await owner.ruf('GET', '/api/servers');
  const smp = (nachher.items ?? nachher).find((s) => s.name === 'Freundeskreis SMP');
  if (smp) {
    const bestand = await owner.ruf('GET', `/servers/${smp.id}/backups`).catch(() => []);
    if ((bestand.items ?? bestand).length < 2) {
      for (let i = 0; i < 2; i += 1) {
        await owner
          .ruf('POST', `/servers/${smp.id}/backups`, { stopServer: false })
          .then(() => console.log('Sicherung angestoßen.'))
          .catch((f) => console.warn(`Sicherung abgelehnt: ${f.message}`));
        await warte(3_000);
      }
    }
  }

  console.log('\nBühne steht.');
}

main().catch((fehler) => {
  console.error('Aufbau abgebrochen:', fehler.message);
  process.exit(1);
});
