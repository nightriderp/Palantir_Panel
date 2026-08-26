import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLogQuerySchema } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import { AUDIT_SERVICE_METHODS, type AuditService, createAuditService, entryFor } from './audit.js';
import { AdminError } from './errors.js';
import {
  actorWith,
  auditEntry,
  createFakeAuditRepository,
  ctxWith,
  ownerActor,
} from './test-support.js';

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../drizzle/0005_admin_ports_audit_storage.sql',
);

/**
 * Das Audit-Log ist append-only (Lastenheft §4, Pflichtenheft §6 und §18,
 * CLAUDE.md §2). Diese Tests halten die Zusicherung auf allen drei Ebenen fest:
 * Service, Repository und Datenbank.
 */
describe('Audit-Log: Unveränderlichkeit', () => {
  it('bietet im Service nur record() und list() an – kein update, kein delete', () => {
    const service: AuditService = createAuditService(createFakeAuditRepository());

    expect(Object.keys(service).sort()).toEqual([...AUDIT_SERVICE_METHODS].sort());
    expect(Object.keys(service)).not.toContain('update');
    expect(Object.keys(service)).not.toContain('remove');
    expect(Object.keys(service)).not.toContain('delete');
  });

  it('verwehrt die Änderung auch dem Owner – es gibt schlicht keinen Weg dorthin', () => {
    const service = createAuditService(createFakeAuditRepository());
    // Der Owner hat alle Permissions (Lastenheft §2). Trotzdem bietet der
    // Service ihm keine Änderungs- oder Löschoperation an: Die Zusicherung
    // hängt nicht an Rechten, sondern an der Schnittstelle.
    const forOwner = service as unknown as Record<string, unknown>;

    expect(ownerActor().permissions.has('audit.view')).toBe(true);
    expect(forOwner['update']).toBeUndefined();
    expect(forOwner['remove']).toBeUndefined();
  });

  it('liefert im permissions-Objekt eines Eintrags ausschließlich canView', async () => {
    const repository = createFakeAuditRepository([auditEntry()]);
    const service = createAuditService(repository);

    const page = await service.list(
      ctxWith(actorWith('audit.view')),
      auditLogQuerySchema.parse({}),
    );
    const [entry] = page.entries;

    expect(entry).toBeDefined();
    expect(Object.keys(entry?.permissions ?? {})).toEqual(['canView']);
  });

  it('sperrt UPDATE, DELETE und TRUNCATE zusätzlich in der Datenbank', () => {
    // Die Regel darf nicht allein im Anwendungscode stehen: Auch ein direkter
    // psql-Zugriff muss am Trigger scheitern (Pflichtenheft §6).
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('CREATE FUNCTION palantir_audit_log_guard()');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "audit_log"');
    expect(migration).toContain('BEFORE TRUNCATE ON "audit_log"');
    expect(migration).toContain("IF TG_OP = 'UPDATE' THEN");
    expect(migration).toContain('AUDIT_ENTRY_IMMUTABLE');
  });

  it('lässt ein DELETE nur dem Archivierungsprozess und nur für alte Einträge zu', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    // Ausweis über die Sitzungsvariable ...
    expect(migration).toContain("current_setting('palantir.audit_archive', true)");
    // ... und zusätzlich die Altersgrenze aus Pflichtenheft §6.
    expect(migration).toContain("interval '24 months'");
  });

  it('legt in der Tabelle keine Spalte für eine Änderung an', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const createTable = migration.slice(
      migration.indexOf('CREATE TABLE "audit_log"'),
      migration.indexOf('--> statement-breakpoint'),
    );

    expect(createTable).not.toContain('updated_at');
  });
});

describe('Audit-Log: Schreiben und Lesen', () => {
  it('hängt Einträge an, statt vorhandene zu überschreiben', async () => {
    const repository = createFakeAuditRepository();
    const service = createAuditService(repository);
    const ctx = ctxWith(actorWith('audit.view', 'node.manage'));

    await service.record(entryFor(ctx, { action: 'node.created', targetType: 'node' }));
    await service.record(entryFor(ctx, { action: 'node.deleted', targetType: 'node' }));

    expect(repository.rows).toHaveLength(2);
    expect(repository.rows.map((row) => row.action)).toEqual(['node.created', 'node.deleted']);
  });

  it('übernimmt Handelnden und Herkunft aus dem Aufrufkontext', async () => {
    const repository = createFakeAuditRepository();
    const service = createAuditService(repository);
    const ctx = ctxWith(actorWith('node.manage'));

    await service.record(entryFor(ctx, { action: 'node.created' }));

    expect(repository.rows[0]).toMatchObject({
      actorId: ctx.userId,
      actorDisplayName: 'Test-Admin',
      ipHint: '10.0.0.x',
    });
  });

  it('lehnt das Lesen ohne audit.view ab', async () => {
    const service = createAuditService(createFakeAuditRepository([auditEntry()]));

    await expect(
      service.list(ctxWith(actorWith('node.manage')), auditLogQuerySchema.parse({})),
    ).rejects.toThrow(AdminError);
  });

  it('liefert Gesamtzahl und Seitengrenzen zur Abfrage zurück', async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      auditEntry({
        id: `audit-${index}`,
        timestamp: new Date(`2026-08-2${index + 1}T10:00:00.000Z`),
      }),
    );
    const service = createAuditService(createFakeAuditRepository(rows));

    const page = await service.list(
      ctxWith(actorWith('audit.view')),
      auditLogQuerySchema.parse({ limit: 2, offset: 1 }),
    );

    expect(page.total).toBe(5);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.entries).toHaveLength(2);
  });
});
