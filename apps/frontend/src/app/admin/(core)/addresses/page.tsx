import { AddressesView } from '@/components/admin/addresses/AddressesView';

export const metadata = {
  title: 'Adressen · Palantir',
};

/** Öffentlicher Port-Bereich der VPS (Arbeitspaket F10, Lastenheft §3.7). */
export default function AdminAddressesPage() {
  return <AddressesView />;
}
