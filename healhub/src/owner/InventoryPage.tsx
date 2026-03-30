import { useEffect, useMemo, useState } from 'react';
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Title, Tooltip } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import OwnerLayout from './OwnerLayout';
import { buildStorageImagePath, createProductImageFallback, isHttpImageUrl, resolveProductImageUrl } from '../services/productImageService';
import { supabase } from '../services/supabaseClient';
import type { Product } from '../types/domain';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

type NewProductForm = {
  name: string;
  category: string;
  description: string;
  price: string;
  stock: string;
  image_url: string;
};

const initialForm: NewProductForm = {
  name: '',
  category: 'General Health',
  description: '',
  price: '',
  stock: '',
  image_url: '',
};

const CATEGORY_LIST = ['Prescription', 'OTC', 'Supplements', 'Personal Care'] as const;

function inferCategory(name: string) {
  const n = name.toLowerCase();
  if (n.includes('vitamin') || n.includes('fish oil') || n.includes('collagen')) return 'Supplements';
  if (n.includes('cream') || n.includes('lotion') || n.includes('cleanser')) return 'Personal Care';
  if (n.includes('rx') || n.includes('antibiotic')) return 'Prescription';
  return 'OTC';
}

function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savingImageId, setSavingImageId] = useState<number | null>(null);
  const [uploadingImageId, setUploadingImageId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null);
  const [newProduct, setNewProduct] = useState<NewProductForm>(initialForm);
  const [creating, setCreating] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchName, setSearchName] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'inStock' | 'outOfStock'>('all');

  async function loadProducts() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category, description, price, stock, low_stock_threshold, image_url, is_active')
        .order('id', { ascending: false });

      if (error) throw error;

      const rows = (data ?? []).map((p: any) => ({
        ...p,
        price: Number(p.price ?? 0),
        stock: Number(p.stock ?? 0),
        low_stock_threshold: Number(p.low_stock_threshold ?? Number(localStorage.getItem('low-stock-default') || 10)),
      })) as Product[];

      setProducts(rows);
      setError('');
    } catch (e: any) {
      setProducts([]);
      setError(e?.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  async function saveProductBasics(product: Product) {
    try {
      setSavingId(product.id);
      const stock = Number(product.stock || 0);
      const price = Number(product.price || 0);

      if (!Number.isFinite(stock) || stock < 0) throw new Error('Stock must be 0 or greater');
      if (!Number.isFinite(price) || price < 0) throw new Error('Price must be 0 or greater');

      const { error } = await supabase
        .from('products')
        .update({ stock, price, category: product.category || 'General Health' })
        .eq('id', product.id);
      if (error) throw error;
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to save product');
    } finally {
      setSavingId(null);
    }
  }

  async function saveImageUrl(productId: number, imageUrl: string) {
    try {
      setSavingImageId(productId);
      const trimmed = imageUrl.trim();
      if (trimmed && !isHttpImageUrl(trimmed)) {
        throw new Error('Image URL must start with http:// or https://');
      }

      const payload = trimmed ? { image_url: trimmed } : { image_url: null };
      const { error } = await supabase.from('products').update(payload).eq('id', productId);
      if (error) throw error;
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to save image URL');
    } finally {
      setSavingImageId(null);
    }
  }

  async function uploadProductImage(productId: number, file: File | null) {
    if (!file) return;
    try {
      setUploadingImageId(productId);
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const filePath = buildStorageImagePath(productId, ext);

      const upload = await supabase.storage.from('product-images').upload(filePath, file, {
        upsert: true,
        contentType: file.type || `image/${ext}`,
      });
      if (upload.error) throw upload.error;

      const { data } = supabase.storage.from('product-images').getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      const update = await supabase.from('products').update({ image_url: publicUrl }).eq('id', productId);
      if (update.error) throw update.error;

      setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, image_url: publicUrl } : p)));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to upload product image');
    } finally {
      setUploadingImageId(null);
    }
  }

  async function toggleProductActive(product: Product) {
    try {
      setTogglingId(product.id);
      const nextActive = !(product.is_active !== false);
      const { error } = await supabase.from('products').update({ is_active: nextActive }).eq('id', product.id);
      if (error) throw error;
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_active: nextActive } : p)));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to update product status');
    } finally {
      setTogglingId(null);
    }
  }

  async function withdrawStock(productId: number, qty: number) {
    if (!Number.isFinite(qty) || qty <= 0) return;

    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const nextStock = Math.max(0, Number(product.stock) - qty);

    try {
      setWithdrawingId(productId);
      const { error } = await supabase.from('products').update({ stock: nextStock }).eq('id', productId);
      if (error) throw error;
      setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, stock: nextStock } : p)));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to withdraw stock');
    } finally {
      setWithdrawingId(null);
    }
  }

  async function deleteProduct(productId: number) {
    const ok = confirm(`Delete product #${productId}? This cannot be undone.`);
    if (!ok) return;

    try {
      setDeletingId(productId);
      const { error } = await supabase.from('products').delete().eq('id', productId);
      if (error) throw error;
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to delete product');
    } finally {
      setDeletingId(null);
    }
  }

  async function createProduct(): Promise<boolean> {
    if (!newProduct.name.trim()) {
      setError('Product name is required');
      return false;
    }

    const price = Number(newProduct.price || 0);
    const stock = Number(newProduct.stock || 0);
    const imageUrl = newProduct.image_url.trim();

    if (!Number.isFinite(price) || price < 0) {
      setError('Price must be 0 or greater');
      return false;
    }

    if (!Number.isFinite(stock) || stock < 0) {
      setError('Stock must be 0 or greater');
      return false;
    }

    if (imageUrl && !isHttpImageUrl(imageUrl)) {
      setError('Image URL must start with http:// or https://');
      return false;
    }

    try {
      setCreating(true);
      const payload: any = {
        name: newProduct.name.trim(),
        category: newProduct.category.trim() || 'General Health',
        description: newProduct.description.trim() || null,
        price,
        stock,
        is_active: true,
      };

      if (imageUrl) payload.image_url = imageUrl;

      const { data, error } = await supabase
        .from('products')
        .insert(payload)
        .select('id, name, category, description, price, stock, low_stock_threshold, image_url, is_active')
        .single();

      if (error) throw error;

      const row = {
        ...(data as any),
        price: Number((data as any).price ?? 0),
        stock: Number((data as any).stock ?? 0),
        low_stock_threshold: Number(localStorage.getItem('low-stock-default') || 10),
      } as Product;

      setProducts((prev) => [row, ...prev]);
      setNewProduct(initialForm);
      setError('');
      return true;
    } catch (e: any) {
      setError(e?.message || 'Failed to create product');
      return false;
    } finally {
      setCreating(false);
    }
  }

  const low = useMemo(() => products.filter((p) => p.stock <= p.low_stock_threshold), [products]);
  const activeCount = useMemo(() => products.filter((p) => p.is_active !== false).length, [products]);
  const inactiveCount = useMemo(() => products.filter((p) => p.is_active === false).length, [products]);
  const totalInventoryValue = useMemo(
    () => products.reduce((sum, p) => sum + Number(p.price || 0) * Number(p.stock || 0), 0),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    return products.filter((p) => {
      const nameMatch = !q || p.name.toLowerCase().includes(q);
      const stockMatch =
        stockFilter === 'all' ? true
          : stockFilter === 'low' ? p.stock <= p.low_stock_threshold
          : stockFilter === 'inStock' ? p.stock > 0
          : p.stock <= 0;
      return nameMatch && stockMatch;
    });
  }, [products, searchName, stockFilter]);

  const inventoryByCategory = useMemo(() => {
    const sums: Record<string, number> = { Prescription: 0, OTC: 0, Supplements: 0, 'Personal Care': 0 };
    for (const p of products) {
      const c = inferCategory(p.name);
      sums[c] += Number(p.stock || 0);
    }
    return {
      labels: [...CATEGORY_LIST],
      datasets: [{ label: 'Inventory Amount', data: CATEGORY_LIST.map((c) => sums[c] || 0), backgroundColor: ['#1d4ed8', '#16a34a', '#d97706', '#db2777'] }],
    };
  }, [products]);

  return (
    <OwnerLayout title="Inventory">
      <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">INVENTORY GROUP</div>
      {loading && <p className="mb-3 text-sm text-slate-500">Loading inventory...</p>}
      {error && <p className="mb-3 text-sm text-rose-600">Error: {error}</p>}
      {!loading && !error && <p className="mb-3 text-sm text-emerald-600">Loaded {products.length} products</p>}
      {!loading && !error && products.length === 0 && <p className="mb-3 text-sm text-amber-700">No inventory data yet.</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Active products</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{activeCount}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Inactive products</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{inactiveCount}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Low stock items</p>
          <p className="mt-1 text-2xl font-bold text-rose-600">{low.length}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Inventory value</p>
          <p className="mt-1 text-2xl font-bold text-indigo-700">{formatMoney(totalInventoryValue)}</p>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          onClick={() => setShowAddForm(true)}
        >
          Add New Product
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          onClick={loadProducts}
        >
          Refresh Inventory
        </button>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Add New Product</p>
              <button
                type="button"
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
                onClick={() => setShowAddForm(false)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <input className="w-full rounded border px-2 py-2 text-sm" placeholder="Product name" value={newProduct.name} onChange={(e) => setNewProduct((f) => ({ ...f, name: e.target.value }))} />
              <select className="w-full rounded border px-2 py-2 text-sm" value={newProduct.category} onChange={(e) => setNewProduct((f) => ({ ...f, category: e.target.value }))}>
                <option value="General Health">General Health</option>
                <option value="Pain Relief">Pain Relief</option>
                <option value="Cold & Flu">Cold & Flu</option>
                <option value="Allergy">Allergy</option>
                <option value="Cough & Respiratory">Cough & Respiratory</option>
                <option value="Digestive Health">Digestive Health</option>
                <option value="Vitamins & Supplements">Vitamins & Supplements</option>
                <option value="First Aid">First Aid</option>
                <option value="Personal Care">Personal Care</option>
              </select>
              <textarea className="w-full rounded border px-2 py-2 text-sm" placeholder="Short description" rows={3} value={newProduct.description} onChange={(e) => setNewProduct((f) => ({ ...f, description: e.target.value }))} />
              <input type="number" className="w-full rounded border px-2 py-2 text-sm" placeholder="Price" value={newProduct.price} onChange={(e) => setNewProduct((f) => ({ ...f, price: e.target.value }))} />
              <input type="number" className="w-full rounded border px-2 py-2 text-sm" placeholder="Stock" value={newProduct.stock} onChange={(e) => setNewProduct((f) => ({ ...f, stock: e.target.value }))} />
              <input className="w-full rounded border px-2 py-2 text-sm" placeholder="Image URL (optional)" value={newProduct.image_url} onChange={(e) => setNewProduct((f) => ({ ...f, image_url: e.target.value }))} />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">Preview</p>
                <img
                  src={newProduct.image_url.trim() && isHttpImageUrl(newProduct.image_url) ? newProduct.image_url.trim() : createProductImageFallback(newProduct.name || 'New Product')}
                  alt={newProduct.name || 'New product preview'}
                  className="h-32 w-full rounded object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = createProductImageFallback(newProduct.name || 'New Product');
                  }}
                />
              </div>
            </div>

            <button className="mt-3 w-full rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-60" onClick={async () => { const ok = await createProduct(); if (ok) setShowAddForm(false); }} disabled={creating}>
              {creating ? 'Adding...' : 'Add Product'}
            </button>
          </div>
        </div>
      )}

      <section className="mb-4 rounded-xl border p-3">
        <h3 className="mb-2 text-sm font-semibold">Inventory by Category (Amount)</h3>
        <Bar data={inventoryByCategory} />
      </section>

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <input className="rounded border px-3 py-2 text-sm" placeholder="Filter by product name..." value={searchName} onChange={(e) => setSearchName(e.target.value)} />
        <select className="rounded border px-3 py-2 text-sm" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as 'all' | 'low' | 'inStock' | 'outOfStock')}>
          <option value="all">All stock</option>
          <option value="low">Low stock only</option>
          <option value="inStock">In stock (&gt; 0)</option>
          <option value="outOfStock">Out of stock (0)</option>
        </select>
        <div className="flex items-center text-xs text-slate-500">Showing {filteredProducts.length} / {products.length}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left">Product</th>
              <th className="text-left">Category</th>
              <th className="text-left">Price</th>
              <th className="text-left">Stock</th>
              <th className="text-left">Threshold</th>
              <th className="text-left">Status</th>
              <th className="text-left">Image</th>
              <th className="text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => (
              <tr key={p.id} className="border-b align-top">
                <td className="py-2">
                  <div className="font-medium text-slate-800">{p.name}</div>
                  <div className="mt-1 line-clamp-2 max-w-xs text-xs text-slate-500">{p.description || 'No description yet.'}</div>
                </td>
                <td>
                  <select
                    className="rounded border px-2 py-1 text-xs"
                    value={p.category || 'General Health'}
                    onChange={(e) => setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, category: e.target.value } : x)))}
                  >
                    <option value="General Health">General Health</option>
                    <option value="Pain Relief">Pain Relief</option>
                    <option value="Cold & Flu">Cold & Flu</option>
                    <option value="Allergy">Allergy</option>
                    <option value="Cough & Respiratory">Cough & Respiratory</option>
                    <option value="Digestive Health">Digestive Health</option>
                    <option value="Vitamins & Supplements">Vitamins & Supplements</option>
                    <option value="First Aid">First Aid</option>
                    <option value="Personal Care">Personal Care</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="w-24 rounded border px-2 py-1"
                    value={Number(p.price || 0)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, price: Number.isFinite(n) ? n : 0 } : x)));
                    }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="w-24 rounded border px-2 py-1"
                    value={p.stock}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, stock: Number.isFinite(n) ? n : 0 } : x)));
                    }}
                  />
                </td>
                <td>{p.low_stock_threshold}</td>
                <td>
                  <div className="space-y-2">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs ${p.is_active === false ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {p.is_active === false ? 'Inactive' : 'Active'}
                    </span>
                    <button
                      className="block rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      onClick={() => toggleProductActive(p)}
                      disabled={togglingId === p.id}
                    >
                      {togglingId === p.id ? 'Updating...' : p.is_active === false ? 'Activate' : 'Deactivate'}
                    </button>
                  </div>
                </td>
                <td>
                  <div className="space-y-2">
                    <img
                      src={resolveProductImageUrl(p)}
                      alt={p.name}
                      className="h-20 w-28 rounded border object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = createProductImageFallback(p.name);
                      }}
                    />
                    <input
                      type="url"
                      className="w-48 rounded border px-2 py-1 text-xs"
                      placeholder="https://..."
                      value={p.image_url || ''}
                      onChange={(e) => {
                        const url = e.target.value;
                        setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, image_url: url } : x)));
                      }}
                      onBlur={(e) => saveImageUrl(p.id, e.target.value)}
                    />
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="block w-48 text-[11px] text-slate-500" onChange={(e) => uploadProductImage(p.id, e.target.files?.[0] || null)} />
                    <div className="text-[10px] text-slate-500">Use a public https URL or upload to the product-images bucket.</div>
                    {savingImageId === p.id && <div className="text-[10px] text-slate-500">Saving image URL...</div>}
                    {uploadingImageId === p.id && <div className="text-[10px] text-slate-500">Uploading image...</div>}
                  </div>
                </td>
                <td>
                  <div className="flex flex-col gap-2">
                    <button className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-60" onClick={() => saveProductBasics(p)} disabled={savingId === p.id}>
                      {savingId === p.id ? 'Saving...' : 'Save changes'}
                    </button>
                    <button
                      className="rounded bg-amber-500 px-2 py-1 text-xs text-white disabled:opacity-60"
                      onClick={() => {
                        const raw = prompt('Withdraw quantity', '1');
                        const qty = Number(raw || 0);
                        withdrawStock(p.id, qty);
                      }}
                      disabled={withdrawingId === p.id}
                    >
                      {withdrawingId === p.id ? 'Withdrawing...' : 'Withdraw stock'}
                    </button>
                    <button className="rounded bg-rose-600 px-2 py-1 text-xs text-white disabled:opacity-60" onClick={() => deleteProduct(p.id)} disabled={deletingId === p.id}>
                      {deletingId === p.id ? 'Deleting...' : 'Delete product'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OwnerLayout>
  );
}
