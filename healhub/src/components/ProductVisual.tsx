import type { Product } from '../types/domain';

function inferVisual(product: Pick<Product, 'name' | 'category'>) {
  const text = `${product.name || ''} ${product.category || ''}`.toLowerCase();

  const form = /syrup|suspension|mouthwash|solution|liquid/.test(text)
    ? 'syrup'
    : /capsule|softgel/.test(text)
      ? 'capsule'
      : /tablet|caplet|lozenge|effervescent/.test(text)
        ? 'tablet'
        : /spray|nasal spray/.test(text)
          ? 'spray'
          : /cream|ointment|gel|lotion/.test(text)
            ? 'tube'
            : /patch|plaster/.test(text)
              ? 'patch'
              : /bottle|drop/.test(text)
                ? 'bottle'
                : 'box';

  const label = /paracetamol|ibuprofen|diclofenac|naproxen|pain|brufen|ponstan|celebrex|voltaren|counterpain|salonpas|tiger balm/.test(text)
    ? 'Pain Relief'
    : /cold|flu|decongestant|tiffy|decolgen|actifed/.test(text)
      ? 'Cold & Flu'
      : /allergy|cetirizine|loratadine|fexofenadine|zyrtec|clarityne|aerius|benadryl|clarinase/.test(text)
        ? 'Allergy Care'
        : /cough|bromhexine|guaifenesin|ambroxol|mucosolvan|bisolvon|fluimucil|prospan|strepsils|difflam/.test(text)
          ? 'Cough & Respiratory'
          : /gaviscon|eno|smecta|imodium|ors|dioralyte|omeprazole|losec|nexium|digestive|famotidine|esomeprazole|loperamide/.test(text)
            ? 'Digestive Health'
            : /vitamin|multivitamin|fish oil|zinc|calcium|magnesium|biotin|collagen|glucosamine|blackmores|centrum|vistra|caltrate|ensure|anlene|naturemade|dhc|glucerna/.test(text)
              ? 'Vitamins & Supplements'
              : /betadine|dettol|hansaplast|nexcare|bandage|patch|first aid|plaster/.test(text)
                ? 'First Aid'
                : /bioderma|cerave|cetaphil|eucerin|nivea|la roche-posay|vaseline|skin|cream|lotion|ointment/.test(text)
                  ? 'Personal Care'
                  : 'Pharmacy Product';

  return { label, form };
}

function VisualIcon({ kind }: { kind: string }) {
  if (kind === 'bottle') {
    return (
      <div className="h-28 w-20 rounded-t-2xl rounded-b-xl border border-slate-300 bg-white shadow-sm">
        <div className="mx-auto mt-2 h-4 w-10 rounded bg-slate-300" />
        <div className="mx-auto mt-5 h-12 w-12 rounded bg-slate-100" />
      </div>
    );
  }

  if (kind === 'tube') {
    return (
      <div className="h-28 w-20 rounded-xl border border-slate-300 bg-white shadow-sm" style={{ clipPath: 'polygon(18% 0, 82% 0, 100% 100%, 0 100%)' }}>
        <div className="mx-auto mt-4 h-4 w-10 rounded bg-slate-300" />
        <div className="mx-auto mt-6 h-10 w-12 rounded bg-slate-100" />
      </div>
    );
  }

  if (kind === 'syrup') {
    return (
      <div className="h-28 w-20 rounded-t-xl rounded-b-2xl border border-slate-300 bg-white px-3 shadow-sm">
        <div className="mx-auto mt-2 h-5 w-8 rounded bg-slate-300" />
        <div className="mx-auto mt-5 h-12 w-full rounded bg-amber-50" />
      </div>
    );
  }

  if (kind === 'capsule') {
    return (
      <div className="flex gap-2">
        <div className="h-10 w-20 rounded-full border border-slate-300 bg-white shadow-sm" />
        <div className="h-10 w-20 rounded-full border border-slate-300 bg-white shadow-sm" />
      </div>
    );
  }

  if (kind === 'tablet') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="h-12 w-12 rounded-full border border-slate-300 bg-white shadow-sm" />
        <div className="h-12 w-12 rounded-full border border-slate-300 bg-white shadow-sm" />
        <div className="h-12 w-12 rounded-full border border-slate-300 bg-white shadow-sm" />
        <div className="h-12 w-12 rounded-full border border-slate-300 bg-white shadow-sm" />
      </div>
    );
  }

  if (kind === 'spray') {
    return (
      <div className="flex items-end gap-2">
        <div className="h-24 w-14 rounded-xl border border-slate-300 bg-white shadow-sm" />
        <div className="mb-6 h-6 w-10 rounded bg-slate-300" />
      </div>
    );
  }

  if (kind === 'patch') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="h-16 w-16 rounded-lg border border-slate-300 bg-white shadow-sm" />
        <div className="h-16 w-16 rounded-lg border border-slate-300 bg-white shadow-sm" />
      </div>
    );
  }

  return <div className="h-24 w-24 rounded-2xl border border-slate-300 bg-white shadow-sm" />;
}

function formText(kind: string) {
  if (kind === 'syrup') return 'Liquid / syrup form';
  if (kind === 'capsule') return 'Capsule form';
  if (kind === 'tablet') return 'Tablet / lozenge form';
  if (kind === 'tube') return 'Cream / gel form';
  if (kind === 'spray') return 'Spray form';
  if (kind === 'patch') return 'Patch form';
  if (kind === 'bottle') return 'Bottle form';
  return 'General package form';
}

export default function ProductVisual({ product, className = '' }: { product: Pick<Product, 'name' | 'category'>; className?: string }) {
  const visual = inferVisual(product);

  return (
    <div className={`flex h-full w-full flex-col justify-between bg-slate-50 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">{visual.label}</div>
      </div>
      <div className="flex flex-1 items-center justify-center py-4">
        <VisualIcon kind={visual.form} />
      </div>
      <div className="border-t border-slate-200 pt-3">
        <p className="line-clamp-2 text-sm font-semibold text-slate-800">{product.name}</p>
        <p className="mt-1 text-xs text-slate-500">{formText(visual.form)}</p>
      </div>
    </div>
  );
}
