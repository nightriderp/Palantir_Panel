import { NodesView } from '@/components/nodes/NodesView';

export const metadata = {
  title: 'Homeserver · Palantir',
};

/** Nodes aus Nutzersicht (Arbeitspaket F7, Lastenheft §3.7). */
export default function NodesPage() {
  return <NodesView />;
}
