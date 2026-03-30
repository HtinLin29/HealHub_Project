const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

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

const brands = ['Sara','Tylenol','Panadol','Tiffy','Decolgen','Actifed','Norgesic','Difelene','Brufen','Ponstan','Celebrex','Voltaren','Dicloflex','Mucosolvan','Bisolvon','Fluimucil','Strepsils','Betadine','Dettol','Amoxy','Augmentin','Clarinase','Zyrtec','Clarityne','Aerius','Nasalin','Gaviscon','Omepra','Losec','Nexium','Eno','Smecta','Imodium','Dioralyte','ProbiX','Berocca','Blackmores','Centrum','Vistra','Mega We Care','DHC','NatureMade','Scotts','Nutrilite','Ensure','Glucerna','Anlene','Caltrate','Bepanthen','Cetaphil','CeraVe','Eucerin','La Roche-Posay','Vaseline','Nivea','Bioderma','Systane','Refresh','Optive','Rohto','Vicks','Tiger Balm','Counterpain','Salonpas','Hansaplast','3M Nexcare','Durex','Okamoto','Skyn','Panthrix','Prospan','Benadryl','Difflam','Strepsil-C','Ammeltz'];
const actives = ['Paracetamol','Ibuprofen','Diclofenac','Naproxen','Cetirizine','Loratadine','Fexofenadine','Pseudoephedrine','Dextromethorphan','Guaifenesin','Ambroxol','Bromhexine','Amoxicillin','Co-amoxiclav','Omeprazole','Esomeprazole','Famotidine','Loperamide','ORS','Probiotic','Vitamin C','Vitamin D3','Calcium','Zinc','Multivitamin','Fish Oil','Collagen','Propolis','Melatonin','Biotin','Magnesium','Glucosamine'];
const forms = ['Tablet','Capsule','Syrup','Suspension','Effervescent','Lozenge','Nasal Spray','Gel','Cream','Ointment','Patch','Spray'];
const strengths = ['60mg','120mg','200mg','250mg','325mg','400mg','500mg','600mg','650mg','5mg','10mg','20mg','30mg','40mg','1000mg'];
const packs = ['10 tablets','20 tablets','30 tablets','60 capsules','100 capsules','60 ml','100 ml','120 ml','15 g','30 g','50 g','5 patches','10 patches'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const rows = [];
const used = new Set();

while (rows.length < 520) {
  const b = rand(brands);
  const ac = rand(actives);
  const st = rand(strengths);
  const f = rand(forms);
  const p = rand(packs);

  const name = `${b} ${ac} ${st} ${f} (${p})`;
  if (used.has(name)) continue;
  used.add(name);

  const price = Number((Math.random() * 690 + 35).toFixed(2));
  const stock = Math.floor(Math.random() * 220) + 8;
  const slug = encodeURIComponent(name.toLowerCase().replace(/[^a-z0-9\s\-]/g, '').trim().replace(/\s+/g, '-'));

  rows.push({
    name,
    price,
    stock,
    image_url: `https://source.unsplash.com/featured/?medicine,pharmacy,${slug}`,
  });
}

(async () => {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase.from('products').insert(chunk);
    if (error) {
      console.error('Insert error at chunk', i, error.message);
      process.exit(1);
    }
    inserted += chunk.length;
  }

  const { count, error } = await supabase.from('products').select('id', { count: 'exact', head: true });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  console.log('Inserted', inserted, 'rows. Total products now:', count);
})();
