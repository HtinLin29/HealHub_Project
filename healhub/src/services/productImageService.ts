import type { Product } from '../types/domain';

function svgDataUri(title: string, subtitle?: string, bg = '#f8fafc', fg = '#0f172a', accent = '#6366f1') {
  const safeTitle = String(title || 'HealHub Product').slice(0, 42);
  const safeSubtitle = String(subtitle || '').slice(0, 40);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450">
      <rect width="600" height="450" fill="${bg}" rx="24" ry="24"/>
      <rect x="38" y="38" width="524" height="374" rx="22" ry="22" fill="#ffffff" stroke="#e2e8f0"/>
      <rect x="64" y="70" width="120" height="120" rx="24" fill="${accent}" opacity="0.14"/>
      <path d="M108 95h32v24h24v32h-24v24h-32v-24H84v-32h24z" fill="${accent}"/>
      <text x="64" y="245" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="${fg}">${safeTitle}</text>
      <text x="64" y="286" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#475569">${safeSubtitle}</text>
      <text x="64" y="352" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#64748b">HealHub Pharmacy</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function isHttpImageUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function inferVisualCategory(productName: string) {
  const text = String(productName || '').toLowerCase();
  if (/paracetamol|ibuprofen|diclofenac|naproxen|pain|brufen|ponstan|celebrex|voltaren|counterpain|salonpas|tiger balm/.test(text)) return { label: 'Pain Relief', accent: '#dc2626' };
  if (/cold|flu|decongestant|tiffy|decolgen|actifed/.test(text)) return { label: 'Cold & Flu', accent: '#2563eb' };
  if (/allergy|cetirizine|loratadine|fexofenadine|zyrtec|clarityne|aerius|benadryl|clarinase/.test(text)) return { label: 'Allergy Care', accent: '#7c3aed' };
  if (/cough|bromhexine|guaifenesin|ambroxol|mucosolvan|bisolvon|fluimucil|prospan|strepsils|difflam/.test(text)) return { label: 'Cough & Respiratory', accent: '#059669' };
  if (/gaviscon|eno|smecta|imodium|ors|dioralyte|omeprazole|losec|nexium|digestive|famotidine|esomeprazole|loperamide/.test(text)) return { label: 'Digestive Health', accent: '#d97706' };
  if (/vitamin|multivitamin|fish oil|zinc|calcium|magnesium|biotin|collagen|glucosamine|blackmores|centrum|vistra|caltrate|ensure|anlene|naturemade|dhc|glucerna/.test(text)) return { label: 'Vitamins & Supplements', accent: '#65a30d' };
  if (/betadine|dettol|hansaplast|nexcare|bandage|patch|first aid|plaster/.test(text)) return { label: 'First Aid', accent: '#db2777' };
  if (/bioderma|cerave|cetaphil|eucerin|nivea|la roche-posay|vaseline|skin|cream|lotion|ointment/.test(text)) return { label: 'Personal Care', accent: '#a21caf' };
  return { label: 'Pharmacy Product', accent: '#6366f1' };
}

function inferProductImagePath(productName: string) {
  const text = String(productName || '').toLowerCase();
  if (/syrup|suspension/.test(text)) return '/products/syrup.png';
  if (/cream|ointment|gel|lotion|skin/.test(text)) return '/products/cream.png';
  if (/spray/.test(text)) return '/products/spray.png';
  if (/bandage|patch|plaster|betadine|dettol|hansaplast|first aid/.test(text)) return '/products/first_aid.png';
  if (/vitamin|multivitamin|fish oil|zinc|calcium|magnesium|biotin|collagen|glucosamine|blackmores|centrum|vistra|caltrate|ensure|anlene|naturemade|dhc|glucerna|powder/.test(text)) return '/products/vitamins.png';
  return '/products/tablets.png';
}

export function createProductImageFallback(productName: string) {
  const visual = inferVisualCategory(productName);
  return svgDataUri(productName || 'HealHub Product', visual.label, '#f8fafc', '#0f172a', visual.accent);
}

export function resolveProductImageUrl(product: Pick<Product, 'name' | 'image_url'>) {
  const raw = String(product.image_url || '').trim();
  if (raw.startsWith('data:image/')) return raw;
  
  // If we have a valid HTTP URL that isn't the discontinued unsplash link, use it
  if (isHttpImageUrl(raw) && !raw.includes('source.unsplash.com')) {
    return raw;
  }
  
  // For empty image URLs or discontinued unsplash links, use local category images
  return inferProductImagePath(product.name);
}

export function buildStorageImagePath(productId: number, extension: string) {
  const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(extension.toLowerCase()) ? extension.toLowerCase() : 'png';
  return `products/${productId}.${safeExt}`;
}
