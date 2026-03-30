import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { supabase } from '../services/supabaseClient';
import { fetchActivePromotions, fetchReviewSummaries, getDiscountedPrice } from '../services/catalogExtrasService';
import { listRecentProductReviews, submitProductReview, type ProductReview } from '../services/productReviewService';
import type { ActivePromotion, Product, ProductReviewSummary } from '../types/domain';
import { createProductImageFallback, resolveProductImageUrl } from '../services/productImageService';
function readCart(): Record<number, number> {
  try {
    const raw = localStorage.getItem('healhub-cart');
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed as any)) {
      const id = Number(k);
      const qty = Number(v);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      out[id] = qty;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCart(cart: Record<number, number>) {
  localStorage.setItem('healhub-cart', JSON.stringify(cart));
}

export default function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [promotions, setPromotions] = useState<ActivePromotion[]>([]);
  const [reviewSummaries, setReviewSummaries] = useState<ProductReviewSummary[]>([]);
  const [cartQty, setCartQty] = useState(0);

  // Add-to-cart quantity modal
  const [qtyOpen, setQtyOpen] = useState(false);
  const [qtyMode, setQtyMode] = useState<'add' | 'buy'>('add');
  const [qty, setQty] = useState(1);

  // Reviews state
  const [recentReviews, setRecentReviews] = useState<ProductReview[]>([]);
  const [allReviewsOpen, setAllReviewsOpen] = useState(false);
  const [allReviewsLoading, setAllReviewsLoading] = useState(false);
  const [allReviews, setAllReviews] = useState<ProductReview[]>([]);

  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError('');

        const id = Number(productId);
        if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid product.');

        const productRes = await supabase
          .from('products')
          .select('id,name,category,description,price,stock,low_stock_threshold,image_url,is_active')
          .eq('id', id)
          .maybeSingle();
        if (productRes.error) throw productRes.error;

        if (!productRes.data) throw new Error('Product not found.');

        setProduct(productRes.data as any);
        setPromotions(await fetchActivePromotions());
        setReviewSummaries(await fetchReviewSummaries());
      } catch (e: any) {
        setError(e?.message || 'Failed to load product.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [productId]);

  useEffect(() => {
    const id = Number(productId);
    if (!Number.isFinite(id) || id <= 0) return;
    const c = readCart();
    setCartQty(Number(c[id] || 0));
  }, [productId]);

  useEffect(() => {
    if (!product) return;
    setReviewRating(5);
    setReviewComment('');
    setReviewError('');
    setAllReviewsOpen(false);
    setAllReviews([]);
    setRecentReviews([]);

    void listRecentProductReviews(product.id, 6)
      .then(setRecentReviews)
      .catch(() => setRecentReviews([]));
  }, [product]);

  const promotion = useMemo(() => {
    if (!product) return null;
    return promotions.find((p) => p.product_id === product.id) || null;
  }, [promotions, product]);

  const discountedPrice = useMemo(() => {
    if (!product) return 0;
    return getDiscountedPrice(Number(product.price), promotion);
  }, [product, promotion]);

  const reviewSummary = useMemo(() => {
    if (!product) return null;
    return reviewSummaries.find((r) => r.product_id === product.id) || null;
  }, [reviewSummaries, product]);

  async function openQty(mode: 'add' | 'buy') {
    if (!product) return;
    if (product.stock <= 0) return;
    setQtyMode(mode);
    setQty(1);
    setQtyOpen(true);
  }

  async function confirmQty() {
    if (!product) return;
    if (product.stock <= 0) return;

    const id = product.id;
    const current = readCart();
    const existing = Number(current[id] || 0);
    const max = Math.max(1, Number(product.stock || 0));
    const safeQty = Math.max(1, Math.min(qty, max));

    if (qtyMode === 'add') {
      const nextQty = Math.min(existing + safeQty, max);
      const next = { ...current, [id]: nextQty };
      writeCart(next);
      setCartQty(nextQty);
      setQtyOpen(false);
      return;
    }

    // buy mode: overwrite to exactly the chosen quantity for checkout
    const next = { ...current, [id]: Math.min(safeQty, max) };
    writeCart(next);
    setCartQty(next[id] || 0);
    localStorage.setItem('healhub-checkout-selection', JSON.stringify([id]));
    setQtyOpen(false);
    navigate('/checkout');
  }

  async function handleSubmitReview() {
    if (!product || reviewSubmitting) return;
    try {
      setReviewSubmitting(true);
      setReviewError('');
      await submitProductReview(product.id, reviewRating, reviewComment);
      // Refresh summaries + reviews
      const [summaries, recent] = await Promise.all([fetchReviewSummaries(), listRecentProductReviews(product.id, 6)]);
      setReviewSummaries(summaries);
      setRecentReviews(recent);
      setReviewRating(5);
      setReviewComment('');
    } catch (e: any) {
      setReviewError(e?.message || 'Could not submit review.');
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function openAllReviews() {
    if (!product) return;
    try {
      setAllReviewsLoading(true);
      setAllReviewsOpen(true);
      const rows = await listRecentProductReviews(product.id, 200);
      setAllReviews(rows);
    } catch {
      setAllReviews([]);
    } finally {
      setAllReviewsLoading(false);
    }
  }

  const reviewCount = reviewSummary?.review_count || 0;
  const avg = reviewSummary?.average_rating || 0;
  const avgRounded = Math.round(avg);
  const cartCount = useMemo(() => {
    const c = readCart();
    return Object.values(c).reduce((sum, qty) => sum + Number(qty || 0), 0);
  }, [cartQty, productId]);

  return (
    <CustomerLayout
      showMobileMenu={false}
      topSlot={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className={`relative rounded-full bg-white p-2 shadow-sm transition ${cartCount > 0 ? 'ring-2 ring-indigo-100' : ''}`}
            aria-label="Cart"
            onClick={() => {
              try {
                localStorage.setItem('healhub-open-cart', '1');
              } catch {
                // ignore
              }
              navigate('/shop');
            }}
          >
            <span className="text-lg">🛒</span>
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-rose-500 px-1.5 text-center text-[10px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </button>
          <Link
            to="/shop"
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← <span>Shop</span>
          </Link>
        </div>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Product Details</p>
          <h1 className="mt-2 text-xl font-bold text-slate-900">{product?.name || 'Loading…'}</h1>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : product ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border bg-slate-50">
            <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
              <img
                src={resolveProductImageUrl(product)}
                alt={product.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = createProductImageFallback(product.name);
                }}
              />
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-slate-500">Price</p>
                <p className="mt-1 text-2xl font-bold text-rose-600">฿{discountedPrice.toFixed(2)}</p>
                {product.stock > 0 ? (
                  <p className="mt-2 text-sm font-semibold text-emerald-700">In stock</p>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-rose-700">Out of stock</p>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-slate-500">Rating</p>
                {reviewSummary ? (
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    ⭐ {reviewSummary.average_rating.toFixed(1)} / 5 ({reviewSummary.review_count} review(s))
                  </p>
                ) : (
                  <p className="mt-1 text-sm font-semibold text-slate-500">No reviews yet</p>
                )}
              </div>
              <div className="text-sm text-slate-500">
                In cart: <span className="font-semibold text-slate-800">{cartQty}</span>
              </div>
            </div>

            {/* Desktop/tablet inline actions */}
            <div className="mt-4 hidden grid-cols-[52px_1fr] gap-2 md:grid">
              <button
                type="button"
                className="rounded-xl bg-indigo-600 px-2 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={product.stock <= 0}
                onClick={() => void openQty('add')}
                aria-label="Add to cart"
                title="Add to cart"
              >
                +
              </button>
              <button
                type="button"
                className="rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:bg-slate-300"
                disabled={product.stock <= 0}
                onClick={() => void openQty('buy')}
              >
                Buy Now
              </button>
            </div>
          </div>

          {product.description && (
            <div className="rounded-2xl border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Description</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{product.description}</p>
            </div>
          )}

          {/* Reviews + rating */}
          <div className="rounded-2xl border bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-base font-semibold text-slate-900">Customer reviews ({reviewCount})</p>
              {reviewCount > 2 && (
                <button type="button" className="text-sm font-semibold text-slate-500 hover:text-slate-700" onClick={() => void openAllReviews()}>
                  See more →
                </button>
              )}
            </div>

            <div className="mb-4 flex items-center gap-2">
              <p className="text-2xl font-bold text-slate-900">{avg.toFixed(1)}</p>
              <p className="text-lg text-amber-400">{'★'.repeat(avgRounded)}{'☆'.repeat(Math.max(0, 5 - avgRounded))}</p>
              <p className="text-sm text-slate-400">/5</p>
            </div>

            {recentReviews.length === 0 ? (
              <p className="text-sm text-slate-500">No reviews yet.</p>
            ) : (
              <div className="space-y-3">
                {recentReviews.slice(0, 2).map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{r.customer_name || 'Customer'}</p>
                      <p className="text-sm text-amber-500">{'★'.repeat(Math.max(0, Math.min(5, r.rating)))}</p>
                    </div>
                    {r.comment ? (
                      <p className="mt-2 text-sm text-slate-700">{r.comment}</p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">Rated without comment.</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">Rate this product</p>
              <div className="mt-2 flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`text-xl ${n <= reviewRating ? 'text-amber-400' : 'text-slate-300'}`}
                    onClick={() => setReviewRating(n)}
                    aria-label={`Rate ${n} star`}
                  >
                    ★
                  </button>
                ))}
                <span className="text-xs text-slate-500">{reviewRating}/5</span>
              </div>

              <textarea
                className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Write your review (optional - you can submit only rating)"
                rows={3}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
              />

              {reviewError && <p className="mt-2 text-xs text-rose-600">{reviewError}</p>}

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300"
                  disabled={reviewSubmitting}
                  onClick={() => void handleSubmitReview()}
                >
                  {reviewSubmitting ? 'Submitting...' : 'Submit review'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Mobile fixed bottom actions */}
      {product && !loading && (
        <div className="fixed bottom-0 left-0 right-0 z-[70] border-t bg-white/95 backdrop-blur md:hidden">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-11 w-11 shrink-0 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={product.stock <= 0}
                onClick={() => void openQty('add')}
                aria-label="Add to cart"
                title="Add to cart"
              >
                +
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:bg-slate-300"
                disabled={product.stock <= 0}
                onClick={() => void openQty('buy')}
              >
                Buy Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quantity modal */}
      {qtyOpen && product && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-3" onMouseDown={() => setQtyOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white p-4 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{qtyMode === 'buy' ? 'Buy now' : 'Add to cart'}</p>
                <h3 className="mt-1 text-base font-bold text-slate-900">{product.name}</h3>
              </div>
              <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setQtyOpen(false)}>
                ✕
              </button>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">Quantity</p>
                <p className="text-xs text-slate-500">Stock: {product.stock}</p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                >
                  −
                </button>
                <div className="min-w-16 text-center text-lg font-semibold text-slate-900">{qty}</div>
                <button
                  type="button"
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => setQty((q) => Math.min(product.stock || 1, q + 1))}
                  disabled={qty >= (product.stock || 0)}
                >
                  +
                </button>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button type="button" className="flex-1 rounded-xl border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setQtyOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300"
                disabled={product.stock <= 0}
                onClick={() => void confirmQty()}
              >
                {qtyMode === 'buy' ? 'Buy now' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* All reviews modal */}
      {allReviewsOpen && product && (
        <div className="fixed inset-0 z-[95] bg-black/40 p-3" onMouseDown={() => setAllReviewsOpen(false)}>
          <div className="mx-auto flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reviews</p>
                <h3 className="text-base font-bold text-slate-900">{product.name}</h3>
              </div>
              <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setAllReviewsOpen(false)}>
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {allReviewsLoading ? (
                <p className="text-sm text-slate-500">Loading reviews...</p>
              ) : allReviews.length === 0 ? (
                <p className="text-sm text-slate-500">No reviews yet.</p>
              ) : (
                <div className="space-y-3">
                  {allReviews.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800">{r.customer_name || 'Customer'}</p>
                        <p className="text-sm text-amber-500">{'★'.repeat(Math.max(0, Math.min(5, r.rating)))}</p>
                      </div>
                      {r.comment ? (
                        <p className="mt-2 text-sm text-slate-700">{r.comment}</p>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">Rated without comment.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
}

