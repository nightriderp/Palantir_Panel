/**
 * Baut die Schritt-für-Schritt-Anleitung zum Anbinden einer frisch angelegten
 * Node (Lastenheft §3.7, Pflichtenheft §2.2). Die vollständige Fassung mit allen
 * Begründungen steht in `SETUP.md §3.4`; hier steht die knappe, mit den konkreten
 * Node-Werten gefüllte Kurzfassung für den Wizard.
 *
 * Bewusst rein und ohne React, damit die erzeugten Befehle/Pfade ohne gerendertes
 * Bauteil prüfbar sind (CLAUDE.md §4). Es werden hier **keine** Geheimnisse
 * erzeugt: Das Agent-Token vergibt das Backend auf ausdrücklichen Klick
 * („Agent-Token" in der Node-Liste) und zeigt es genau einmal an; diese
 * Anleitung verweist nur darauf und nennt als Rückfallweg das geteilte
 * `AGENT_TOKEN` aus der zentralen `.env` – aber nur, solange dieser Rückfallweg
 * überhaupt gilt (siehe {@link NodeSetupParams.sharedTokenFallback}).
 */

/** Auf welcher Maschine ein Schritt ausgeführt wird (CLAUDE.md §9). */
export type SetupMachine = 'homeserver' | 'vps';

export interface NodeSetupStep {
  title: string;
  machine: SetupMachine;
  /** Erklärender Fließtext. */
  body: string;
  /** Optionaler Befehl bzw. Dateiinhalt zum Kopieren. */
  code?: string;
}

export interface NodeSetupParams {
  name: string;
  /** Tunnel-Adresse der neuen Node, z. B. `10.10.0.2`. */
  wireguardIp: string;
  /** Tunnel-Adresse der VPS (Backend-Seite). Vorgabe `10.10.0.1`. */
  vpsWireguardIp?: string;
  /**
   * Kennung der Node (`HostNode.id`).
   *
   * Steht als `AGENT_NODE_ID` in der `.env` der Node; damit prüft das Backend
   * beim Verbindungsaufbau, dass Token und Node zusammenpassen (WORK_STATUS.md,
   * Gefundener Punkt 57). Ohne Angabe bleibt ein Platzhalter stehen.
   */
  nodeId?: string;
  /**
   * GHCR-Konto, unter dem die Palantir-Images liegen – der Nutzername im
   * `docker login`.
   *
   * Bewusst ein Parameter mit Platzhalter statt eines festen Namens (Audit
   * frontend-lib-15): Der Name gehört dem Betreiber, nicht der Software. Vorher
   * stand hier ein konkretes Konto fest im Code; eine andere Installation hätte
   * den Befehl kopiert und sich mit einem fremden Konto angemeldet, worauf der
   * Pull scheitert.
   */
  registryUser?: string;
  /**
   * Gilt das geteilte `AGENT_TOKEN` aus der zentralen `.env` der VPS noch als
   * Rückfallweg? (Fundpunkt 160.)
   *
   * Nur bei **genau einer** eingetragenen Node. Ab der zweiten lehnt das
   * Backend es beim Verbindungsaufbau mit Close-Code 4401 ab (Fundpunkt 149,
   * `apps/backend/src/modules/server-orchestration/agent-route.ts`). Ohne diese
   * Unterscheidung nennt die Anleitung einen Rückfallweg, den es in dieser
   * Installation nicht mehr gibt – und widerspricht damit der Warnung, die der
   * Wizard eine Ansicht vorher zeigt.
   *
   * Vorgabe `true`: die Installation mit einem Homeserver, für die dieser
   * Rückfallweg gedacht ist.
   */
  sharedTokenFallback?: boolean;
}

const DEFAULT_VPS_WIREGUARD_IP = '10.10.0.1';

/** Steht im Befehl, solange der Betreiber sein Registry-Konto nicht nennt. */
const REGISTRY_USER_PLACEHOLDER = '<GitHub-Nutzer>';

export function buildNodeSetupSteps(params: NodeSetupParams): NodeSetupStep[] {
  const vpsIp = params.vpsWireguardIp ?? DEFAULT_VPS_WIREGUARD_IP;
  const backendWsUrl = `ws://${vpsIp}:4000/agent`;
  const registryUser = params.registryUser ?? REGISTRY_USER_PLACEHOLDER;
  const rueckfallweg =
    (params.sharedTokenFallback ?? true)
      ? "Ist noch keines vergeben, gilt weiterhin das geteilte AGENT_TOKEN der VPS-.env (auslesen auf der VPS: grep '^AGENT_TOKEN=' /opt/palantir/.env)."
      : 'Ein Rückfall auf das geteilte AGENT_TOKEN der VPS-.env gibt es hier nicht mehr: Ab zwei eingetragenen Nodes lehnt das Backend es mit Close-Code 4401 ab. Jede Node braucht ihr eigenes.';

  return [
    {
      title: 'WireGuard-Tunnel einrichten',
      machine: 'homeserver',
      body: `Die Gameserver-VM „${params.name}" braucht im Tunnel-Netz die feste Adresse ${params.wireguardIp} (Pflichtenheft §2.1). Richte WireGuard so ein, dass die VM genau diese IP erhält, und stelle sicher, dass wg-quick@wg0 vor Docker startet – sonst existiert die Adresse beim Containerstart noch nicht.`,
      code: 'systemctl is-enabled wg-quick@wg0',
    },
    {
      title: 'Repository auschecken',
      machine: 'homeserver',
      body: 'Das Panel-Repository nach /opt/palantir klonen und auf den freigegebenen Stand setzen (dorthin zeigt auch das Image-Tag prod). Deploy-Key und known_hosts wie in SETUP.md §3.4 unter /etc/palantir ablegen.',
      code: 'git -C /opt/palantir checkout --detach origin/prod',
    },
    {
      title: 'Datenverzeichnisse anlegen',
      machine: 'homeserver',
      body: 'Die Pfade müssen zu AGENT_DATA_DIR und AGENT_BACKUP_DIR aus der .env passen.',
      code: 'mkdir -p /srv/palantir/servers /srv/palantir/backups',
    },
    {
      title: 'Agent-Token für diese Node erzeugen',
      machine: 'vps',
      body: `In der Node-Liste bei „${params.name}" auf „Agent-Token" klicken. Das Token wird genau einmal angezeigt – gespeichert ist im Backend nur sein Hash. Jedes neue Token entwertet das bisherige. Damit ist die Verbindung eindeutig dieser Node zugeordnet; ein kompromittierter Agent betrifft keine andere.`,
    },
    {
      title: '.env der Gamenode anlegen',
      machine: 'homeserver',
      body: `Datei /opt/palantir/.env (in der Gameserver-VM) von Hand anlegen. AGENT_TOKEN ist der einzige Wert, der von der VPS herüber muss: das eben erzeugte Token dieser Node. ${rueckfallweg} Passt der Wert nicht, weist das Backend die Verbindung im Handshake ab.`,
      code: [
        'NODE_ENV=production',
        'LOG_LEVEL=info',
        'PALANTIR_VERSION=prod',
        'SOCKET_PROXY_VERSION=<derselbe Wert wie auf der VPS>',
        'AGENT_TOKEN=<Token dieser Node aus dem Panel>',
        `AGENT_NODE_ID=${params.nodeId ?? '<Kennung dieser Node aus dem Panel>'}`,
        `AGENT_BACKEND_WS_URL=${backendWsUrl}`,
        'AGENT_DATA_DIR=/srv/palantir/servers',
        'AGENT_BACKUP_DIR=/srv/palantir/backups',
      ].join('\n'),
    },
    {
      title: 'An der Registry anmelden',
      machine: 'homeserver',
      body: `Das Agent-Image liegt in einem privaten GHCR-Repository. Nötig ist ein Personal Access Token (classic) mit read:packages. Als Nutzername steht ${registryUser} im Befehl – das GitHub-Konto, dem die Images gehören (derselbe Wert wie AGENT_REGISTRY_USERNAME in der zentralen .env). Die Anmeldung muss nach /etc/palantir/docker schreiben, nicht nach /root.`,
      code: `read -rsp 'Token: ' T; echo; echo "$T" | DOCKER_CONFIG=/etc/palantir/docker docker login ghcr.io -u ${registryUser} --password-stdin; unset T`,
    },
    {
      title: 'Agent-Stack starten',
      machine: 'homeserver',
      body: 'Den Gamenode-Stack starten. Sobald der Agent verbindet, wechselt die Node hier automatisch auf „online".',
      code:
        'export DOCKER_CONFIG=/etc/palantir/docker && cd /opt/palantir/deploy/gamenode && ' +
        'docker compose --env-file ../../.env up -d',
    },
    {
      title: 'Erreichbarkeit prüfen',
      machine: 'vps',
      body: `Auf der VPS testen, ob der Agent-Kanal über den Tunnel erreichbar ist. 200 heißt erreichbar, 000 heißt: der Backend-Port ist nicht an ${vpsIp} veröffentlicht.`,
      code: `curl -s -o /dev/null -w '%{http_code}\\n' http://${vpsIp}:4000/health`,
    },
  ];
}
