import { NodesAdminView } from '@/components/admin/nodes/NodesAdminView';

export const metadata = {
  title: 'Nodes · Palantir',
};

/** Node-Verwaltung und -Onboarding (Lastenheft §3.7). */
export default function AdminNodesPage() {
  return <NodesAdminView />;
}
