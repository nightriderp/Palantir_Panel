/**
 * Auswahl der umzustellenden Bestandsserver (Fundpunkt 242).
 *
 * Der Lauf greift in die Port-Vergabe einer laufenden Installation ein. Was er
 * anfasst, entscheidet sich hier - nicht erst an der Datenbank.
 */

import { describe, expect, it } from 'vitest';
import { planeUmstellung, type UmstellungsKandidat } from './ports-bestandsserver.js';
import type { ServerPortAssignment } from '../modules/server-orchestration/types.js';

const ROUTER_PORT = 25_565;
const GEROUTET = new Set(['minecraft-paper', 'minecraft-vanilla']);

function server(
  ueberschreibung: Partial<UmstellungsKandidat> & { assignedPorts: ServerPortAssignment[] },
): UmstellungsKandidat {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Testserver',
    gameType: 'minecraft-paper',
    dockerContainerId: null,
    ...ueberschreibung,
  };
}

function primaer(publicPort: number): ServerPortAssignment {
  return {
    publicPort,
    containerPort: 25_565,
    protocol: 'tcp',
    label: 'Spiel-Port',
    primary: true,
  };
}

describe('Umstellung der Bestandsserver (Fundpunkt 242)', () => {
  it('nimmt einen gerouteten Server mit eigener Portnummer auf', () => {
    const plan = planeUmstellung(
      [server({ assignedPorts: [primaer(25_007)] })],
      GEROUTET,
      ROUTER_PORT,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]?.alterPort).toBe(25_007);
    expect(plan[0]?.neueZuweisungen[0]?.publicPort).toBe(ROUTER_PORT);
  });

  it('laesst einen Server ohne Routing in Ruhe', () => {
    // Ein Spiel ohne Hostname-Routing braucht seine eigene Nummer - sie
    // freizugeben machte den Server unerreichbar.
    const plan = planeUmstellung(
      [server({ gameType: 'test-echo', assignedPorts: [primaer(25_003)] })],
      GEROUTET,
      ROUTER_PORT,
    );

    expect(plan).toEqual([]);
  });

  it('ist wiederholbar: ein bereits umgestellter Server kommt nicht zweimal dran', () => {
    const plan = planeUmstellung(
      [server({ assignedPorts: [primaer(ROUTER_PORT)] })],
      GEROUTET,
      ROUTER_PORT,
    );

    expect(plan).toEqual([]);
  });

  it('fasst nur die primaere Zuweisung an', () => {
    /*
     * Minecraft mit Bedrock: Der zweite Port wird weiterhin auf den Host
     * gebunden (`buildContainerSpec` filtert nur den primaeren heraus) und
     * behaelt deshalb seine Nummer samt Pool-Eintrag.
     */
    const bedrock: ServerPortAssignment = {
      publicPort: 25_008,
      containerPort: 19_132,
      protocol: 'udp',
      label: 'Bedrock',
      primary: false,
    };

    const plan = planeUmstellung(
      [server({ assignedPorts: [primaer(25_007), bedrock] })],
      GEROUTET,
      ROUTER_PORT,
    );

    expect(plan[0]?.alterPort).toBe(25_007);
    expect(plan[0]?.protokoll).toBe('tcp');
    expect(plan[0]?.neueZuweisungen).toEqual([{ ...primaer(ROUTER_PORT) }, bedrock]);
  });

  it('merkt sich, ob ein Container da ist', () => {
    // Nur dann braucht der Server einen Neustart, damit der Container ohne die
    // alte Bindung neu gebaut wird.
    const mit = planeUmstellung(
      [server({ assignedPorts: [primaer(25_007)], dockerContainerId: 'abc' })],
      GEROUTET,
      ROUTER_PORT,
    );
    const ohne = planeUmstellung(
      [server({ assignedPorts: [primaer(25_007)] })],
      GEROUTET,
      ROUTER_PORT,
    );

    expect(mit[0]?.hatContainer).toBe(true);
    expect(ohne[0]?.hatContainer).toBe(false);
  });

  it('geht ueber einen Server ohne primaeren Port hinweg, statt zu werfen', () => {
    const plan = planeUmstellung([server({ assignedPorts: [] })], GEROUTET, ROUTER_PORT);

    expect(plan).toEqual([]);
  });
});
