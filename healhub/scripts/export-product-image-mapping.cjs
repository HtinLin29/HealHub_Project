const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

(async () => {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,image_url')
    .order('name', { ascending: true });

  if (error) throw error;

  const csv = ['id,product_name,product_image_url'];
  for (const r of data || []) {
    const name = String(r.name || '').replace(/"/g, '""');
    const url = String(r.image_url || '').replace(/"/g, '""');
    csv.push(`${r.id},"${name}","${url}"`);
  }

  fs.writeFileSync('product-image-mapping.csv', csv.join('\n'));
  console.log(`WROTE ${data?.length || 0} rows to product-image-mapping.csv`);
})();
