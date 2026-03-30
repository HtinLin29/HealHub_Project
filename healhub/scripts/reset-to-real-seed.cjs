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

const realProducts = [
  { name: 'Sara Paracetamol 500mg Tablets', price: 35, stock: 120, image_url: null },
  { name: 'Tylenol Extra Strength 500mg Caplets', price: 120, stock: 80, image_url: null },
  { name: 'Panadol Advance 500mg Tablets', price: 95, stock: 90, image_url: null },
  { name: 'Nurofen Ibuprofen 200mg Tablets', price: 145, stock: 70, image_url: null },
  { name: 'Ponstan Mefenamic Acid 500mg Capsules', price: 220, stock: 40, image_url: null },
  { name: 'Zyrtec Cetirizine 10mg Tablets', price: 165, stock: 65, image_url: null },
  { name: 'Clarityne Loratadine 10mg Tablets', price: 210, stock: 55, image_url: null },
  { name: 'Aerius Desloratadine 5mg Tablets', price: 280, stock: 45, image_url: null },
  { name: 'Tiffy Decongestant Tablets', price: 70, stock: 100, image_url: null },
  { name: 'Decolgen Tablets', price: 75, stock: 95, image_url: null },
  { name: 'Actifed Cold Syrup 60ml', price: 110, stock: 60, image_url: null },
  { name: 'Mucosolvan Ambroxol Syrup 120ml', price: 165, stock: 50, image_url: null },
  { name: 'Bisolvon Bromhexine Syrup 60ml', price: 120, stock: 75, image_url: null },
  { name: 'Strepsils Original Lozenges', price: 95, stock: 130, image_url: null },
  { name: 'Difflam Lozenges', price: 130, stock: 65, image_url: null },
  { name: 'Betadine Gargle & Mouthwash 125ml', price: 155, stock: 70, image_url: null },
  { name: 'Counterpain Analgesic Cream 60g', price: 145, stock: 85, image_url: null },
  { name: 'Salonpas Pain Relief Patches', price: 115, stock: 90, image_url: null },
  { name: 'Tiger Balm Red Ointment 30g', price: 120, stock: 70, image_url: null },
  { name: 'Gaviscon Double Action Liquid 150ml', price: 210, stock: 60, image_url: null },
  { name: 'ENO Fruit Salt 100g', price: 75, stock: 95, image_url: null },
  { name: 'Smecta Sachets', price: 140, stock: 70, image_url: null },
  { name: 'Imodium 2mg Capsules', price: 180, stock: 55, image_url: null },
  { name: 'ORS Electrolyte Sachets', price: 60, stock: 110, image_url: null },
  { name: 'Blackmores Bio C 1000mg Tablets', price: 450, stock: 40, image_url: null },
  { name: 'Blackmores Fish Oil 1000mg Capsules', price: 520, stock: 45, image_url: null },
  { name: 'Centrum Multivitamin Tablets', price: 390, stock: 50, image_url: null },
  { name: 'Vistra Zinc 15mg Tablets', price: 220, stock: 60, image_url: null },
  { name: 'Caltrate 600+D Plus Minerals Tablets', price: 550, stock: 35, image_url: null },
  { name: 'Ensure Gold Vanilla 850g', price: 820, stock: 30, image_url: null }
];

(async () => {
  // remove product references from orders first
  const { error: orderRefErr } = await supabase
    .from('orders')
    .update({ product_id: null })
    .not('product_id', 'is', null);
  if (orderRefErr) throw new Error(`orders update failed: ${orderRefErr.message}`);

  // delete all existing products
  const { error: delErr } = await supabase.from('products').delete().gt('id', 0);
  if (delErr) throw new Error(`delete products failed: ${delErr.message}`);

  // insert curated real list
  const { error: insErr } = await supabase.from('products').insert(realProducts);
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);

  const { count, error: countErr } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true });
  if (countErr) throw new Error(`count failed: ${countErr.message}`);

  console.log(`Done. Products now: ${count}`);
})();
