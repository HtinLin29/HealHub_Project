const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

function placeholder(label, bg = 'f8fafc', fg = '0f172a') {
  return `https://placehold.co/600x600/${bg}/${fg}.png?text=${encodeURIComponent(label)}`;
}

const CATEGORY_IMAGES = {
  pain: placeholder('Pain Relief', 'fee2e2', '991b1b'),
  cold: placeholder('Cold & Flu', 'dbeafe', '1d4ed8'),
  allergy: placeholder('Allergy Care', 'ede9fe', '6d28d9'),
  cough: placeholder('Cough & Respiratory', 'dcfce7', '166534'),
  digestive: placeholder('Digestive Health', 'fef3c7', '92400e'),
  vitamins: placeholder('Vitamins & Supplements', 'ecfccb', '3f6212'),
  firstaid: placeholder('First Aid', 'ffe4e6', 'be123c'),
  personalcare: placeholder('Personal Care', 'fae8ff', 'a21caf'),
  general: placeholder('Pharmacy Product', 'e2e8f0', '334155'),
};

function imageUrlFor(product) {
  const text = `${product.name || ''} ${product.category || ''}`.toLowerCase();

  if (/paracetamol|ibuprofen|diclofenac|naproxen|celebrex|ponstan|brufen|counterpain|salonpas|tiger balm|pain/.test(text)) return CATEGORY_IMAGES.pain;
  if (/cold|flu|decongestant|actifed|decolgen|tiffy/.test(text)) return CATEGORY_IMAGES.cold;
  if (/allergy|cetirizine|loratadine|fexofenadine|zyrtec|clarityne|aerius|benadryl|clarinase/.test(text)) return CATEGORY_IMAGES.allergy;
  if (/cough|bromhexine|guaifenesin|ambroxol|mucosolvan|bisolvon|fluimucil|prospan|strepsils|difflam/.test(text)) return CATEGORY_IMAGES.cough;
  if (/gaviscon|eno|smecta|imodium|ors|dioralyte|omeprazole|losec|nexium|digestive|famotidine|esomeprazole|loperamide/.test(text)) return CATEGORY_IMAGES.digestive;
  if (/vitamin|multivitamin|fish oil|zinc|calcium|magnesium|biotin|collagen|glucosamine|blackmores|centrum|vistra|caltrate|ensure|anlene|naturemade|dhc|glucerna/.test(text)) return CATEGORY_IMAGES.vitamins;
  if (/betadine|dettol|hansaplast|nexcare|bandage|patch|first aid|plaster/.test(text)) return CATEGORY_IMAGES.firstaid;
  if (/bioderma|cerave|cetaphil|eucerin|nivea|la roche-posay|vaseline|skin|cream|lotion|ointment|personal care/.test(text)) return CATEGORY_IMAGES.personalcare;
  return CATEGORY_IMAGES.general;
}

(async () => {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,category,image_url')
    .order('id', { ascending: true });

  if (error) throw error;

  const rows = data || [];
  let updated = 0;

  for (const row of rows) {
    const { error: updateError } = await supabase
      .from('products')
      .update({ image_url: imageUrlFor(row) })
      .eq('id', row.id);

    if (updateError) throw updateError;
    updated += 1;
  }

  console.log(JSON.stringify({ updated, total: rows.length }, null, 2));
})();
