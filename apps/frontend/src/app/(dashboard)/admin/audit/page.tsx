import { AuditLogView } from '@/components/admin/audit/AuditLogView';

export const metadata = {
  title: 'Audit-Log · Palantir',
};

/** Audit-Log (Arbeitspaket F10, Lastenheft §3.7) – rein lesend. */
export default function AdminAuditPage() {
  return <AuditLogView />;
}
