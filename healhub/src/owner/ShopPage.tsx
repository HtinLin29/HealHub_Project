import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CustomerLayout from '../customer/CustomerLayout';
import { readOwnerAiFeatureEnabled } from '../env';
import type { KpiSummary } from '../types/domain';
import { fetchActivePromotions, fetchReviewSummaries, getDiscountedPrice } from '../services/catalogExtrasService';
import { fetchProducts } from '../services/dashboardService';
import { createProductImageFallback, resolveProductImageUrl } from '../services/productImageService';
import { listRecentProductReviews, submitProductReview, type ProductReview } from '../services/productReviewService';
import type { ActivePromotion, Product, ProductReviewSummary } from '../types/domain';

const OwnerAssistant = lazy(() => import('../components/OwnerAssistant'));

const ownerAiEnabled = readOwnerAiFeatureEnabled();

const ownerAssistantFallbackKpis: KpiSummary = {
  totalOrders: 0,
  totalRevenue: 0,
  totalStock: 0,
  revenueOrderCount: 0,
  pendingOrders: 0,
  cancelledOrders: 0,
  avgOrderValue: 0,
  activeProductCount: 0,
};

export default function ShopPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  /** Owner opens Storefront from owner home — same shop UI without customer nav/checkout. */
  const isOwnerPreview = role === 'owner';
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const onlyInStock = false;
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cartPulse, setCartPulse] = useState(false);
  const [addSheet, setAddSheet] = useState<{ product: Product; discountedPrice: number; promoName?: string | null } | null>(null);
  const [addQty, setAddQty] = useState(1);
  const [cart, setCart] = useState<Record<number, number>>(() => {
    try {
      const raw = localStorage.getItem('healhub-cart');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [reviewSummaries, setReviewSummaries] = useState<ProductReviewSummary[]>([]);
  const [promotions, setPromotions] = useState<ActivePromotion[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [recentReviews, setRecentReviews] = useState<ProductReview[]>([]);
  const [allReviewsOpen, setAllReviewsOpen] = useState(false);
  const [allReviewsLoading, setAllReviewsLoading] = useState(false);
  const [allReviews, setAllReviews] = useState<ProductReview[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [checkoutSelection, setCheckoutSelection] = useState<Set<number>>(new Set());

  useEffect(() => {
    try {
      const flag = localStorage.getItem('healhub-open-cart');
      if (flag === '1') {
        setCartOpen(true);
        localStorage.removeItem('healhub-open-cart');
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedProduct(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedProduct]);

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 420);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;
    setReviewRating(5);
    setReviewComment('');
    setReviewError('');
    setAllReviewsOpen(false);
    setAllReviews([]);
    void listRecentProductReviews(selectedProduct.id)
      .then(setRecentReviews)
      .catch(() => setRecentReviews([]));
  }, [selectedProduct]);

  useEffect(() => {
    if (!addSheet) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddSheet(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addSheet]);

  useEffect(() => {
    if (!addSheet) return;
    const product = addSheet.product;
    const currentInCart = Number(cart[product.id] || 0);
    const maxAdd = Math.max(0, product.stock - currentInCart);
    const effectiveMax = maxAdd > 0 ? maxAdd : 1;
    setAddQty((q) => Math.min(Math.max(1, q), effectiveMax));
  }, [addSheet, cart]);

  useEffect(() => {
    const shouldLockScroll = cartOpen || Boolean(selectedProduct) || Boolean(addSheet);
    if (!shouldLockScroll) return;

    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [cartOpen, selectedProduct, addSheet]);

  useEffect(() => {
    Promise.all([fetchProducts(), fetchReviewSummaries(), fetchActivePromotions()])
      .then(([rows, reviews, promos]) => {
        setProducts(rows);
        setReviewSummaries(reviews);
        setPromotions(promos);
        setError('');
      })
      .catch((e: any) => {
        setProducts([]);
        setReviewSummaries([]);
        setPromotions([]);
        setError(e?.message || 'Could not load products right now.');
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      const matchText = !q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
      const matchStock = !onlyInStock || p.stock > 0;
      const matchCategory = selectedCategory === 'All' || (p.category || 'General') === selectedCategory;
      return matchText && matchStock && matchCategory;
    });
  }, [products, query, onlyInStock, selectedCategory]);

  const categoryTabs = useMemo(() => {
    const unique = Array.from(new Set(products.map((p) => (p.category || 'General').trim()).filter(Boolean)));
    return ['All', ...unique];
  }, [products]);

  const reviewMap = useMemo(() => new Map(reviewSummaries.map((r) => [r.product_id, r])), [reviewSummaries]);
  const promotionMap = useMemo(() => new Map(promotions.map((p) => [p.product_id, p])), [promotions]);

  const cartCount = useMemo(() => Object.values(cart).reduce((sum, qty) => sum + qty, 0), [cart]);
  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([productId, qty]) => {
        const product = products.find((p) => p.id === Number(productId));
        if (!product) return null;
        const promo = promotionMap.get(product.id);
        const unitPrice = getDiscountedPrice(Number(product.price), promo);
        return {
          product,
          qty,
          lineTotal: unitPrice * Number(qty),
        };
      })
      .filter(Boolean) as { product: Product; qty: number; lineTotal: number }[];
  }, [cart, products, promotionMap]);

  const selectedCartItems = useMemo(() => {
    if (checkoutSelection.size === 0) return cartItems;
    return cartItems.filter((i) => checkoutSelection.has(i.product.id));
  }, [cartItems, checkoutSelection]);

  const selectedSubtotal = useMemo(() => selectedCartItems.reduce((sum, item) => sum + item.lineTotal, 0), [selectedCartItems]);

  useEffect(() => {
    localStorage.setItem('healhub-cart', JSON.stringify(cart));
  }, [cart]);

  function confirmAddToCart(productId: number, qty: number) {
    if (!qty || qty <= 0) return;
    setCart((prev) => ({ ...prev, [productId]: (prev[productId] || 0) + qty }));
    setCartPulse(true);
    window.setTimeout(() => setCartPulse(false), 220);
    setAddSheet(null);
  }

  function updateCartQty(productId: number, nextQty: number) {
    setCart((prev) => {
      if (nextQty <= 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: nextQty };
    });
  }

  function clearCart() {
    setCart({});
  }

  function goToCheckout() {
    if (isOwnerPreview) return;
    setCartOpen(false);
    const ids = selectedCartItems.map((i) => i.product.id);
    localStorage.setItem('healhub-checkout-selection', JSON.stringify(ids));
    navigate('/checkout');
  }

  async function handleSubmitReview() {
    if (!selectedProduct || reviewSubmitting || isOwnerPreview) return;
    try {
      setReviewSubmitting(true);
      setReviewError('');
      await submitProductReview(selectedProduct.id, reviewRating, reviewComment);
      setReviewComment('');
      setReviewRating(5);
      const [reviews, summaries] = await Promise.all([
        listRecentProductReviews(selectedProduct.id),
        fetchReviewSummaries(),
      ]);
      setRecentReviews(reviews);
      if (allReviewsOpen) {
        const full = await listRecentProductReviews(selectedProduct.id, 200);
        setAllReviews(full);
      }
      setReviewSummaries(summaries);
    } catch (e: any) {
      setReviewError(e?.message || 'Could not submit review.');
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function openAllReviews() {
    if (!selectedProduct) return;
    try {
      setAllReviewsLoading(true);
      setAllReviewsOpen(true);
      const rows = await listRecentProductReviews(selectedProduct.id, 200);
      setAllReviews(rows);
    } catch {
      setAllReviews([]);
    } finally {
      setAllReviewsLoading(false);
    }
  }

  return (
    <CustomerLayout
      previewMode={isOwnerPreview}
      showMobileMenu={!isOwnerPreview}
      topSlot={
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {isOwnerPreview ? (
              <button
                type="button"
                onClick={() => navigate('/owner')}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-xl font-black leading-none text-slate-900 shadow-sm hover:bg-slate-50 md:hidden"
                aria-label="Back to dashboard"
              >
                ←
              </button>
            ) : null}
            <div className="flex min-w-0 flex-1 items-center rounded-xl border-2 border-rose-500 bg-white px-2">
              <span className="mr-1 text-sm text-slate-500">🔍</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products"
                className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
              />
              <button type="button" className="py-2 pl-1 text-sm font-semibold text-rose-600">
                Search
              </button>
            </div>
            <button
              type="button"
              className={`relative rounded-full bg-white p-2 transition ${cartPulse ? 'scale-105 ring-2 ring-rose-200' : ''}`}
              aria-label="Cart"
              onClick={() => setCartOpen(true)}
            >
              <span className="text-lg">🛒</span>
              <span className={`absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1.5 text-center text-[10px] font-bold text-white ${cartPulse ? 'animate-pulse' : ''}`}>
                {cartCount}
              </span>
            </button>
          </div>

          <div className={`${isOwnerPreview ? '-mr-1' : '-ml-[3.25rem] -mr-1 w-[calc(100%+3.25rem)]'} flex items-center gap-3 overflow-x-auto px-1 pb-1 md:-mx-1 md:w-auto`}>
            {categoryTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSelectedCategory(tab)}
                className={`shrink-0 border-b-2 px-1 py-1 text-sm font-semibold ${
                  selectedCategory === tab
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          Loading products...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500 shadow-sm">
          {products.length === 0
            ? 'No products are available yet.'
            : 'No products match your current search/filter.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((p) => {
          const review = reviewMap.get(p.id);
          const promo = promotionMap.get(p.id);
          const discountedPrice = getDiscountedPrice(Number(p.price), promo);
          return (
          <article
            key={p.id}
            className="cursor-pointer overflow-hidden rounded-lg bg-white transition hover:-translate-y-0.5"
            onClick={() => (isOwnerPreview ? setSelectedProduct(p) : navigate(`/product/${p.id}`))}
            role="button"
            aria-label={`Open ${p.name}`}
          >
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-slate-100">
              <img
                src={resolveProductImageUrl(p)}
                alt={p.name}
                className="h-full w-full object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = createProductImageFallback(p.name);
                }}
              />
              {promo && (
                <span className="absolute left-2 top-2 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  SALE
                </span>
              )}
            </div>
            <div className="space-y-1 p-1.5">
              <h3 className="line-clamp-2 min-h-[2.1rem] text-[12px] font-semibold leading-4 text-slate-800">{p.name}</h3>
              <div className="flex items-end justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-[16px] font-bold leading-4 text-rose-600">฿{discountedPrice.toFixed(2)}</p>
                  {promo && <p className="truncate text-[10px] text-slate-400 line-through">฿{Number(p.price).toFixed(2)}</p>}
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                  {p.stock > 0 ? 'In stock' : 'Out'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <p className="truncate">
                  {review ? `⭐ ${review.average_rating.toFixed(1)} (${review.review_count})` : '⭐ New'}
                </p>
                {promo ? <p className="truncate text-rose-600">Promo</p> : <span />}
              </div>
            </div>
          </article>
        );})}
      </div>

      {cartOpen && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/40 overscroll-contain">
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl overscroll-contain">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Your Cart</h3>
                <p className="text-xs text-slate-500">{cartCount} item(s)</p>
              </div>
              <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setCartOpen(false)}>✕</button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {cartItems.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">Your cart is empty.</div>
              ) : (
                cartItems.map(({ product, qty, lineTotal }) => (
                  <div key={product.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checkoutSelection.size === 0 ? true : checkoutSelection.has(product.id)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setCheckoutSelection((prev) => {
                              const next = new Set(prev);
                              // If selection is empty (meaning "all"), initialize it to all ids first
                              if (next.size === 0) {
                                for (const it of cartItems) next.add(it.product.id);
                              }
                              if (checked) next.add(product.id);
                              else next.delete(product.id);
                              return next;
                            });
                          }}
                          aria-label="Select item for checkout"
                        />
                        <div className="min-w-0">
                        <p className="font-medium text-slate-800">{product.name}</p>
                        <p className="text-xs text-slate-500">{product.category || 'General Health'}</p>
                        </div>
                      </div>
                      <p className="font-semibold text-indigo-700">฿{lineTotal.toFixed(2)}</p>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button className="rounded border px-2 py-1 text-sm" onClick={() => updateCartQty(product.id, qty - 1)}>-</button>
                      <span className="min-w-8 text-center text-sm font-medium">{qty}</span>
                      <button className="rounded border px-2 py-1 text-sm" onClick={() => updateCartQty(product.id, qty + 1)} disabled={qty >= product.stock}>+</button>
                      <button className="ml-auto text-xs text-rose-600 hover:underline" onClick={() => updateCartQty(product.id, 0)}>Remove</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t p-4">
              {isOwnerPreview ? (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  Preview mode: checkout is disabled. Sign in as a customer to test the full purchase flow.
                </p>
              ) : null}
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-slate-500">Subtotal (selected)</span>
                <span className="font-semibold text-slate-800">฿{selectedSubtotal.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700" onClick={clearCart}>Clear Cart</button>
                <button
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:bg-slate-300"
                  disabled={cartItems.length === 0 || selectedCartItems.length === 0 || isOwnerPreview}
                  title={isOwnerPreview ? 'Use a customer account to checkout' : undefined}
                  onClick={goToCheckout}
                >
                  Checkout
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedProduct && (() => {
        const selectedReview = reviewMap.get(selectedProduct.id);
        const selectedPromo = promotionMap.get(selectedProduct.id);
        const selectedDiscountedPrice = getDiscountedPrice(Number(selectedProduct.price), selectedPromo);
        return (
        <div
          className="fixed inset-0 z-[70] bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={() => setSelectedProduct(null)}
        >
          <div
            className="mx-auto flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            style={{ maxHeight: 'calc(100vh - 2rem)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Product Details</h3>
                <p className="text-xs text-slate-500">Preview of how this item appears to customers.</p>
              </div>
              <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setSelectedProduct(null)}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            <div className="mb-4 h-52 w-full overflow-hidden rounded-lg border bg-slate-100">
              <img
                src={resolveProductImageUrl(selectedProduct)}
                alt={selectedProduct.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = createProductImageFallback(selectedProduct.name);
                }}
              />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                {selectedProduct.category || 'General'}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${selectedProduct.stock > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                {selectedProduct.stock > 0 ? `${selectedProduct.stock} in stock` : 'Out of stock'}
              </span>
            </div>

            <div className="grid gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Product name</p>
                <p className="mt-1 font-medium text-slate-800">{selectedProduct.name}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Price</p>
                <p className="mt-1 font-semibold text-indigo-700">฿{selectedDiscountedPrice.toFixed(2)}</p>
                {selectedPromo && <p className="text-xs text-slate-400 line-through">฿{Number(selectedProduct.price).toFixed(2)}</p>}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Category</p>
                <p className="mt-1">{selectedProduct.category || 'General'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Product ID</p>
                <p className="mt-1">#{selectedProduct.id}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              {selectedPromo && <p className="mb-2 text-sm font-medium text-rose-600">Active promotion: {selectedPromo.promotion_name}</p>}
              <p className="mb-2 text-sm text-amber-600">{selectedReview ? `⭐ ${selectedReview.average_rating.toFixed(1)} from ${selectedReview.review_count} review(s)` : 'No reviews yet'}</p>
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Description</p>
              <p className="text-sm leading-6 text-slate-700">
                {selectedProduct.description || 'No description available yet.'}
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-800">Rate this product</p>
              {isOwnerPreview ? (
                <p className="mt-2 text-xs text-slate-500">
                  Review submission is hidden in storefront preview. Customers can leave reviews when signed in as a shopper.
                </p>
              ) : (
                <>
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
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      disabled={reviewSubmitting}
                      onClick={() => void handleSubmitReview()}
                    >
                      {reviewSubmitting ? 'Submitting...' : 'Submit review'}
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-base font-semibold text-slate-900">
                  Customer reviews ({selectedReview?.review_count || recentReviews.length || 0})
                </p>
                <button
                  type="button"
                  className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                  onClick={() => void openAllReviews()}
                >
                  See more
                </button>
              </div>
              <div className="mb-4 flex items-center gap-2">
                <p className="text-2xl font-bold text-slate-900">{selectedReview ? selectedReview.average_rating.toFixed(1) : '0.0'}</p>
                <p className="text-lg text-slate-400">/5</p>
                <p className="text-xl text-amber-400">
                  {'★'.repeat(Math.round(selectedReview?.average_rating || 0))}
                  {'☆'.repeat(Math.max(0, 5 - Math.round(selectedReview?.average_rating || 0)))}
                </p>
              </div>

              {recentReviews.length === 0 ? (
                <p className="text-sm text-slate-500">No reviews yet.</p>
              ) : (
                <div className="space-y-3">
                  {recentReviews.slice(0, 2).map((r) => (
                    <div key={r.id} className="rounded-lg border border-slate-200 p-3">
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
        </div>
      ); })()}

      {allReviewsOpen && selectedProduct && (
        <div className="fixed inset-0 z-[85] bg-black/40 p-4" onMouseDown={() => setAllReviewsOpen(false)}>
          <div
            className="mx-auto flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reviews</p>
                <h3 className="text-base font-bold text-slate-900">{selectedProduct.name}</h3>
              </div>
              <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setAllReviewsOpen(false)}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {allReviewsLoading ? (
                <p className="text-sm text-slate-500">Loading reviews...</p>
              ) : allReviews.length === 0 ? (
                <p className="text-sm text-slate-500">No reviews yet.</p>
              ) : (
                <div className="space-y-3">
                  {allReviews.map((r) => (
                    <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800">{r.customer_name || 'Customer'}</p>
                        <p className="text-sm text-amber-500">{'★'.repeat(Math.max(0, Math.min(5, r.rating)))}</p>
                      </div>
                      {r.comment ? (
                        <p className="mt-2 text-sm text-slate-700">{r.comment}</p>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">Rated without comment.</p>
                      )}
                      <p className="mt-2 text-xs text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {addSheet && (() => {
        const product = addSheet.product;
        const currentInCart = Number(cart[product.id] || 0);
        const maxAdd = Math.max(0, product.stock - currentInCart);

        return (
          <div
            className="fixed inset-0 z-[70] bg-black/40"
            role="dialog"
            aria-modal="true"
            onMouseDown={() => setAddSheet(null)}
          >
            <div
              className="absolute bottom-0 left-0 right-0 mx-auto w-full max-w-2xl rounded-t-3xl bg-white shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Add to cart</p>
                  <p className="text-xs text-slate-500">Choose quantity and confirm.</p>
                </div>
                <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setAddSheet(null)} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="grid gap-4 px-4 py-4 sm:grid-cols-[160px_1fr] sm:px-6">
                <div className="h-32 w-full overflow-hidden rounded-2xl border bg-slate-100 sm:h-40">
                  <img
                    src={resolveProductImageUrl(product)}
                    alt={product.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = createProductImageFallback(product.name);
                    }}
                  />
                </div>

                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{product.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{product.category || 'General'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-indigo-700">฿{addSheet.discountedPrice.toFixed(2)}</p>
                    {addSheet.promoName && <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">Promo: {addSheet.promoName}</span>}
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${product.stock > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                    </span>
                    {currentInCart > 0 && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{currentInCart} already in cart</span>}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-700">Quantity</p>
                      <div className="flex items-center overflow-hidden rounded-xl border">
                        <button
                          className="px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                          onClick={() => setAddQty((q) => Math.max(1, q - 1))}
                          disabled={addQty <= 1}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <div className="min-w-12 border-x px-3 py-2 text-center text-sm font-semibold text-slate-800">{addQty}</div>
                        <button
                          className="px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                          onClick={() => setAddQty((q) => Math.min(Math.max(1, maxAdd || 1), q + 1))}
                          disabled={maxAdd <= 0 || addQty >= Math.max(1, maxAdd)}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-xs text-slate-500">Total</p>
                      <p className="text-base font-bold text-slate-800">฿{(addSheet.discountedPrice * addQty).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t px-4 py-4 sm:px-6">
                <div className="grid grid-cols-2 gap-2">
                  <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setCartOpen(true)}>
                    View cart
                  </button>
                  <button
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    disabled={product.stock <= 0 || maxAdd <= 0}
                    onClick={() => confirmAddToCart(product.id, addQty)}
                  >
                    {product.stock <= 0 ? 'Out of stock' : maxAdd <= 0 ? 'Max in cart' : 'Confirm add'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {showBackToTop && (
        <button
          type="button"
          className="fixed bottom-24 right-4 z-[75] rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg ring-1 ring-slate-200 hover:bg-slate-50"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
        >
          ↑ Top
        </button>
      )}
      {isOwnerPreview && ownerAiEnabled ? (
        <Suspense fallback={null}>
          <OwnerAssistant
            kpis={ownerAssistantFallbackKpis}
            products={[]}
            recentOrders={[]}
            monthlyRevenue={[]}
          />
        </Suspense>
      ) : null}
    </CustomerLayout>
  );
}
