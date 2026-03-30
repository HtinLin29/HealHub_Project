import OwnerLayout from './OwnerLayout';

const rows = [
  { supplier: 'MediSupply', item: 'Vitamin C', qty: 200, status: 'Pending' },
  { supplier: 'CarePharma', item: 'Pain Relief', qty: 120, status: 'Approved' },
];

export default function PurchasePage() {
  return (
    <OwnerLayout title="Purchase">
      <table className="min-w-full text-sm">
        <thead><tr className="border-b"><th className="py-2 text-left">Supplier</th><th className="text-left">Item</th><th className="text-left">Qty</th><th className="text-left">Status</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b"><td className="py-2">{r.supplier}</td><td>{r.item}</td><td>{r.qty}</td><td>{r.status}</td></tr>)}</tbody>
      </table>
    </OwnerLayout>
  );
}
