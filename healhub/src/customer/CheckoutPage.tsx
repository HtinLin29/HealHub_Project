import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { fetchActivePromotions, getDiscountedPrice } from '../services/catalogExtrasService';
import { createCheckoutOrder } from '../services/checkoutService';
import { fetchProducts } from '../services/dashboardService';
import { fetchDefaultAddress, type SavedAddress } from '../services/addressService';
import { fetchDefaultPatient, type Patient } from '../services/patientService';
import { fetchDefaultPaymentMethod, type PaymentMethod as SavedPaymentMethod } from '../services/paymentService';
import { createProductImageFallback, resolveProductImageUrl } from '../services/productImageService';
import type { ActivePromotion, Product } from '../types/domain';

type ShippingMethod = 'standard' | 'express';
type PaymentMethod = 'visa' | 'mobile_banking' | 'cod';

function readCart(): Record<number, number> {
  try {
    const raw = localStorage.getItem('healhub-cart');
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
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

function clearCart() {
  localStorage.removeItem('healhub-cart');
}

function writeCart(cart: Record<number, number>) {
  localStorage.setItem('healhub-cart', JSON.stringify(cart));
}

function readCheckoutSelection(): number[] | null {
  try {
    const raw = localStorage.getItem('healhub-checkout-selection');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return null;
  }
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<ActivePromotion[]>([]);
  const [addressLoaded, setAddressLoaded] = useState(false);
  const [defaultAddress, setDefaultAddress] = useState<SavedAddress | null>(null);
  const [patientLoaded, setPatientLoaded] = useState(false);
  const [defaultPatient, setDefaultPatient] = useState<Patient | null>(null);
  const [paymentLoaded, setPaymentLoaded] = useState(false);
  const [defaultCard, setDefaultCard] = useState<SavedPaymentMethod | null>(null);

  const [note, setNote] = useState('');
  const [shipping, setShipping] = useState<ShippingMethod>('standard');
  const [payment, setPayment] = useState<PaymentMethod>('cod');
  const [applySellerCoupon, setApplySellerCoupon] = useState(true);
  const [useBonus, setUseBonus] = useState(false);
  const [placing, setPlacing] = useState(false);

  const [cart, setCart] = useState<Record<number, number>>(() => readCart());
  const promotionMap = useMemo(() => new Map(promotions.map((p) => [p.product_id, p])), [promotions]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    const fromCart = Object.keys(readCart()).map(Number);
    const fromSelection = readCheckoutSelection();
    if (fromSelection && fromSelection.length > 0) return new Set(fromSelection);
    return new Set(fromCart);
  });

  useEffect(() => {
    // Ensure selection stays in sync if cart changes (paid items removed, etc).
    setSelectedIds((prev) => {
      const next = new Set<number>();
      const ids = Object.keys(cart).map(Number);
      for (const id of ids) {
        if (prev.has(id)) next.add(id);
      }
      // If nothing selected but cart has items, default to select all.
      if (next.size === 0 && ids.length > 0) {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }, [cart]);

  useEffect(() => {
    Promise.all([fetchProducts(), fetchActivePromotions(), fetchDefaultAddress(), fetchDefaultPatient(), fetchDefaultPaymentMethod()])
      .then(([rows, promos, savedAddress, savedPatient, savedCard]) => {
        setProducts(rows);
        setPromotions(promos);
        setError('');

        if (savedAddress) {
          setDefaultAddress(savedAddress);
          setAddressLoaded(true);
        }

        if (savedPatient) {
          setDefaultPatient(savedPatient);
          setPatientLoaded(true);
        }

        if (savedCard) {
          setDefaultCard(savedCard);
          setPaymentLoaded(true);
        }
      })
      .catch((e: any) => {
        setProducts([]);
        setPromotions([]);
        setError(e?.message || 'Could not load checkout data.');
      })
      .finally(() => setLoading(false));
  }, []);

  const cartItems = useMemo(() => {
    const ids = Object.keys(cart).map(Number);
    const byId = new Map(products.map((p) => [p.id, p]));
    return ids
      .map((id) => {
        const product = byId.get(id);
        const qty = Number(cart[id] || 0);
        if (!product || qty <= 0) return null;
        const promo = promotionMap.get(product.id);
        const unitPrice = getDiscountedPrice(Number(product.price), promo);
        return { product, qty, unitPrice, promo, originalUnitPrice: Number(product.price) };
      })
      .filter(Boolean) as { product: Product; qty: number; unitPrice: number; originalUnitPrice: number; promo?: ActivePromotion | null }[];
  }, [cart, products, promotionMap]);

  const selectedItems = useMemo(() => cartItems.filter((row) => selectedIds.has(row.product.id)), [cartItems, selectedIds]);

  const originalSubtotal = useMemo(() => selectedItems.reduce((sum, row) => sum + row.originalUnitPrice * row.qty, 0), [selectedItems]);
  const productSubtotal = useMemo(() => selectedItems.reduce((sum, row) => sum + row.unitPrice * row.qty, 0), [selectedItems]);
  const productDiscount = Math.max(0, originalSubtotal - productSubtotal);

  const shippingFee = shipping === 'express' ? 49 : 17;
  const shippingDiscount = shipping === 'standard' ? shippingFee : 0; // mimic “Free shipping” on standard
  const shippingNet = Math.max(0, shippingFee - shippingDiscount);

  const sellerCoupon = applySellerCoupon ? 5 : 0;
  const availableBonus = 4;

  const preBonusTotal = Math.max(0, productSubtotal - sellerCoupon + shippingNet);
  const bonusApplied = useBonus ? Math.min(availableBonus, preBonusTotal) : 0;
  const orderTotal = Math.max(0, preBonusTotal - bonusApplied);

  async function placeOrder() {
    try {
      setPlacing(true);
      setError('');

      if (cartItems.length === 0) {
        throw new Error('Your cart is empty.');
      }
      if (selectedItems.length === 0) {
        throw new Error('Please select at least one item to pay now.');
      }

      if (!defaultPatient) throw new Error('Please select a patient.');
      if (!defaultAddress) throw new Error('Please select a delivery address.');

      // Shipping method / notes are UI-only; delivery address is saved on the order row.
      void note;

      const payloadWithPricing = selectedItems.map((row) => ({
        product: row.product,
        qty: row.qty,
        unit_price: row.unitPrice,
      }));
      const result = await createCheckoutOrder(payloadWithPricing, {
        patientId: defaultPatient.id,
        orderTotal,
        paymentMethod: payment,
        checkoutNote: note.trim() || null,
        delivery: {
          label: defaultAddress.label,
          full_name: defaultAddress.full_name,
          phone: defaultAddress.phone,
          address_line1: defaultAddress.address_line1,
          address_line2: defaultAddress.address_line2,
        },
      });

      // Remove only paid items from cart; keep unpaid items.
      setCart((prev) => {
        const next: Record<number, number> = { ...prev };
        for (const row of selectedItems) {
          delete next[row.product.id];
        }
        if (Object.keys(next).length === 0) {
          clearCart();
        } else {
          writeCart(next);
        }
        return next;
      });
      navigate(`/order-success/${result.orderId}`, {
        replace: true,
        state: {
          total: result.total,
          itemCount: result.itemCount,
          shipping,
          fullName: String(defaultPatient.full_name || ''),
          remainingCount: Object.keys(cart).length - selectedItems.length,
        },
      });
    } catch (e: any) {
      setError(e?.message || 'Checkout failed');
    } finally {
      setPlacing(false);
    }
  }

  return (
    <CustomerLayout>
      <div className="mb-4 rounded-2xl bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-600 px-4 py-5 text-white md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-100">Checkout</p>
            <h2 className="mt-2 text-2xl font-bold">Review and place your order</h2>
            <p className="mt-2 max-w-2xl text-sm text-blue-100">Delivery details, shipping, payment, and order summary — all in one place.</p>
          </div>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
            onClick={() => {
              // Go to the previous page in navigation history (usually ProductDetailPage).
              // If there is no history (rare), fall back to shop.
              try {
                if (window.history.length > 1) navigate(-1);
                else navigate('/shop');
              } catch {
                navigate('/shop');
              }
            }}
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
              ←
            </span>
            <span>Back</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          Loading checkout...
        </div>
      )}

      {!loading && error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && cartItems.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Your cart is empty. Go back to the shop to add items.
          <div className="mt-3">
            <Link className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700" to="/shop">
              Back to shop
            </Link>
          </div>
        </div>
      )}

      {!loading && cartItems.length > 0 && (
        <div className="grid gap-4 pb-24 lg:grid-cols-[1fr_420px]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-800">Patient</h3>
                <Link className="text-sm font-medium text-indigo-600 hover:underline" to="/account/patients?returnTo=%2Fcheckout">
                  Change
                </Link>
              </div>

              {patientLoaded && defaultPatient ? (
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {defaultPatient.full_name}{defaultPatient.age !== null && defaultPatient.age !== undefined ? ` (${defaultPatient.age})` : ''}
                      </p>
                      <p className="mt-1 break-words text-sm text-slate-700">
                        {defaultPatient.gender ? `Gender: ${defaultPatient.gender}` : 'Gender: —'}
                        {defaultPatient.allergy ? ` • Allergy: ${defaultPatient.allergy}` : ''}
                      </p>
                      <p className="mt-2 text-xs text-emerald-700">Default patient</p>
                    </div>
                    <span className="text-slate-400">›</span>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  No patient selected yet.
                  <div className="mt-2">
                    <Link className="font-medium text-rose-700 underline" to="/account/patients?returnTo=%2Fcheckout">
                      Add / choose a patient
                    </Link>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-800">Delivery address</h3>
                <Link className="text-sm font-medium text-indigo-600 hover:underline" to="/account/address?returnTo=%2Fcheckout">
                  Change
                </Link>
              </div>

              {addressLoaded && defaultAddress ? (
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {defaultAddress.full_name || 'Saved address'}{defaultAddress.phone ? `  ${defaultAddress.phone}` : ''}
                      </p>
                      <p className="mt-1 break-words text-sm text-slate-700">{defaultAddress.address_line1}</p>
                      {defaultAddress.address_line2 && <p className="break-words text-sm text-slate-500">{defaultAddress.address_line2}</p>}
                      <p className="mt-2 text-xs text-emerald-700">Default address</p>
                    </div>
                    <span className="text-slate-400">›</span>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  No delivery address selected yet.
                  <div className="mt-2">
                    <Link className="font-medium text-rose-700 underline" to="/account/address?returnTo=%2Fcheckout">
                      Add / choose an address
                    </Link>
                  </div>
                </div>
              )}

              <div className="mt-4">
                <textarea
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Add note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-800">Bonus</h3>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-slate-800">Use ฿{availableBonus.toFixed(2)}</p>
                  <button
                    type="button"
                    onClick={() => setUseBonus((v) => !v)}
                    className={`relative h-7 w-12 rounded-full transition ${useBonus ? 'bg-indigo-600' : 'bg-slate-300'}`}
                    aria-pressed={useBonus}
                  >
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${useBonus ? 'left-6' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">Bonus credit reduces your order total (demo).</p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-base font-semibold text-slate-800">Shipping method</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={`rounded-2xl border p-4 text-left transition ${shipping === 'standard' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => setShipping('standard')}
                >
                  <p className="text-sm font-semibold text-slate-800">Standard</p>
                  <p className="mt-1 text-xs text-slate-500">2–4 days • Free</p>
                </button>
                <button
                  type="button"
                  className={`rounded-2xl border p-4 text-left transition ${shipping === 'express' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => setShipping('express')}
                >
                  <p className="text-sm font-semibold text-slate-800">Express</p>
                  <p className="mt-1 text-xs text-slate-500">Same/next day • ฿49</p>
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-base font-semibold text-slate-800">Payment method</h3>
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition ${payment === 'visa' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => setPayment('visa')}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800">VISA</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {paymentLoaded && defaultCard
                        ? `•••• ${defaultCard.last4}${defaultCard.exp_month && defaultCard.exp_year ? ` • Exp ${String(defaultCard.exp_month).padStart(2, '0')}/${String(defaultCard.exp_year).slice(-2)}` : ''}`
                        : 'Add or choose a card'}
                    </p>
                  </div>
                  <span className={`h-4 w-4 rounded-full border ${payment === 'visa' ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'}`} />
                </button>

                {payment === 'visa' && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">Visa card</p>
                      <Link className="text-xs font-medium text-indigo-600 hover:underline" to="/account/payment?returnTo=%2Fcheckout">
                        Change / add
                      </Link>
                    </div>
                    {!defaultCard ? (
                      <p className="mt-1 text-sm">No saved card yet.</p>
                    ) : (
                      <p className="mt-1 text-sm font-medium">•••• {defaultCard.last4}</p>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition ${payment === 'mobile_banking' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => setPayment('mobile_banking')}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Mobile banking</p>
                    <p className="mt-1 text-xs text-slate-500">Pay via your banking app (demo)</p>
                  </div>
                  <span className={`h-4 w-4 rounded-full border ${payment === 'mobile_banking' ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'}`} />
                </button>

                <button
                  type="button"
                  className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition ${payment === 'cod' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => setPayment('cod')}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Cash on delivery</p>
                    <p className="mt-1 text-xs text-slate-500">Pay when received</p>
                  </div>
                  <span className={`h-4 w-4 rounded-full border ${payment === 'cod' ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'}`} />
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-800">Items</h3>
                <Link to="/shop" className="text-sm font-medium text-indigo-600 hover:underline">
                  Continue shopping
                </Link>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <label className="flex items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === cartItems.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(cartItems.map((r) => r.product.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                  />
                  Select all
                </label>
                <p className="text-xs text-slate-500">
                  Paying now: <span className="font-semibold text-slate-700">{selectedItems.reduce((s, r) => s + r.qty, 0)}</span> item(s)
                </p>
              </div>
              <div className="mt-4 space-y-3">
                {cartItems.map((row) => (
                  <div key={row.product.id} className="flex gap-3 rounded-2xl border border-slate-200 p-3">
                    <div className="pt-1">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.product.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(row.product.id);
                            else next.delete(row.product.id);
                            return next;
                          });
                        }}
                        aria-label="Select item"
                      />
                    </div>
                    <div className="h-16 w-16 overflow-hidden rounded-xl border bg-slate-100">
                      <img
                        src={resolveProductImageUrl(row.product)}
                        alt={row.product.name}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = createProductImageFallback(row.product.name);
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{row.product.name}</p>
                      <p className="text-xs text-slate-500">{row.product.category || 'General'}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-sm font-bold text-indigo-700">฿{row.unitPrice.toFixed(2)}</p>
                        <p className="text-xs font-medium text-slate-700">x{row.qty}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="text-base font-semibold text-slate-800">Order summary</h3>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Product subtotal</span>
                <span className="font-medium text-slate-800">฿{productSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Original price</span>
                <span className="text-slate-500 line-through">฿{originalSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Product discount</span>
                <span className="font-medium text-rose-600">-฿{productDiscount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Seller coupons</span>
                <span className="font-medium text-rose-600">{applySellerCoupon ? `-฿${sellerCoupon.toFixed(2)}` : '—'}</span>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Apply seller coupon</span>
                <input type="checkbox" checked={applySellerCoupon} onChange={(e) => setApplySellerCoupon(e.target.checked)} />
              </label>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Shipping fee</span>
                <span className="font-medium text-slate-800">฿{shippingFee.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Shipping discount</span>
                <span className="font-medium text-rose-600">-฿{shippingDiscount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Bonus used</span>
                <span className="font-medium text-rose-600">{bonusApplied > 0 ? `-฿${bonusApplied.toFixed(2)}` : '—'}</span>
              </div>
              <div className="my-3 border-t" />
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Total</span>
                <span className="text-lg font-bold text-slate-900">฿{orderTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="mt-4">
              <button
                className="w-full rounded-full bg-rose-500 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={placing || selectedItems.length === 0}
                onClick={placeOrder}
              >
                {placing ? 'Placing…' : 'Place order'}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Place order button is inside the page flow (not fixed) */}
    </CustomerLayout>
  );
}

