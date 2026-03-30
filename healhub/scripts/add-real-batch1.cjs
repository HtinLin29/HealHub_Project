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

const batch1 = [
  'Panadol Cold & Flu Day Tablets',
  'Panadol Cold & Flu Night Tablets',
  'Panadol Extend 665mg Tablets',
  'Tylenol Cold Day Caplets',
  'Tylenol Cold Night Caplets',
  'Nurofen Express 200mg Capsules',
  'Nurofen Zavance 200mg Tablets',
  'Advil Ibuprofen 200mg Tablets',
  'Brufen 400mg Tablets',
  'Voltaren Emulgel 1% 50g',
  'Dicloflex Gel 30g',
  'Celebrex 200mg Capsules',
  'Ponstan Forte 500mg Capsules',
  'Clarinase Repetabs',
  'Aerius 5mg Tablets',
  'Zyrtec Oral Solution 75ml',
  'Clarityne Syrup 60ml',
  'Benadryl Cough Syrup 150ml',
  'Prospan Cough Syrup 100ml',
  'Fluimucil 600mg Effervescent Tablets',
  'Mucinex Expectorant Tablets',
  'Bisolvon Kids Syrup 60ml',
  'Mucosolvan Tablets 30mg',
  'Strepsils Honey & Lemon Lozenges',
  'Strepsils Orange Vitamin C Lozenges',
  'Difflam Spray 30ml',
  'Betadine Throat Spray 50ml',
  'Betadine Antiseptic Solution 60ml',
  'Dettol Antiseptic Liquid 500ml',
  'ENO Lemon Sachets',
  'Gaviscon Double Action Tablets',
  'Omeprazole 20mg Capsules',
  'Losec MUPS 20mg Tablets',
  'Nexium 20mg Tablets',
  'Imodium Instant Melts',
  'Smecta Orange Sachets',
  'Dioralyte Electrolyte Sachets',
  'Berocca Performance Orange Tablets',
  'Blackmores Bio Zinc Tablets',
  'Blackmores Evening Primrose Oil Capsules',
  'Centrum Silver Multivitamin',
  'Vistra Acerola Cherry 1000mg',
  'DHC Vitamin C 60 Days',
  'Nature Made Fish Oil 1200mg',
  'Scotts Emulsion Original 400ml',
  'Ensure Gold HMB 400g',
  'Glucerna Triple Care 850g',
  'Anlene Gold 5X 800g',
  'Caltrate Plus Minerals 60 Tablets',
  'Hansaplast Elastic Plaster 100 Strips'
];

function randomPrice(min, max) {
  return Number((Math.random() * (max - min) + min).toFixed(2));
}

const rows = batch1.map((name) => ({
  name,
  price: randomPrice(60, 980),
  stock: Math.floor(Math.random() * 120) + 15,
  image_url: null,
}));

(async () => {
  const { error } = await supabase.from('products').insert(rows);
  if (error) throw new Error(error.message);

  const { count, error: countErr } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true });
  if (countErr) throw new Error(countErr.message);

  console.log(`Inserted ${rows.length} products. Total now: ${count}`);
})();
