import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import AuthPage from './auth/AuthPage';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import AddressPage from './customer/AddressPage';
import AddCardPage from './customer/AddCardPage';
import PaymentMethodsPage from './customer/PaymentMethodsPage';
import PatientsPage from './customer/PatientsPage';
import CheckoutPage from './customer/CheckoutPage';
import OrderSuccessPage from './customer/OrderSuccessPage';
import MyOrdersPage from './customer/MyOrdersPage';
import OrderTrackingPage from './customer/OrderTrackingPage';
import OrderChatPage from './customer/OrderChatPage';
import CustomerInboxPage from './customer/CustomerInboxPage';
import CustomerProfilePage from './customer/CustomerProfilePage';
import ProductDetailPage from './customer/ProductDetailPage';
import OwnerShell from './owner/OwnerShell';
import OwnerDashboard from './owner/OwnerDashboard';
import FulfillmentPage from './owner/FulfillmentPage';
import FulfillmentOrderPage from './owner/FulfillmentOrderPage';
import OwnerHome from './owner/OwnerHome';
import OwnerChatInboxPage from './owner/OwnerChatInboxPage';
import RefundRequestsPage from './owner/RefundRequestsPage';
import TodoPage from './owner/TodoPage';
import CrmPage from './owner/CrmPage';
import CrmPatientDetailPage from './owner/CrmPatientDetailPage';
import SalePage from './owner/SalePage';
import SaleOrderDetailPage from './owner/SaleOrderDetailPage';
import ShopPage from './owner/ShopPage';
import PurchasePage from './owner/PurchasePage';
import InventoryPage from './owner/InventoryPage';
import SettingsPage from './owner/SettingsPage';
import { useTheme } from './context/ThemeContext';

function Home() {
  const { session, role, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div className="bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-600 px-6 py-10 text-white md:px-10">
          <p className="text-xs uppercase tracking-[0.2em] text-blue-100">HealHub Platform</p>
          <h1 className="mt-2 text-3xl font-bold md:text-4xl">Medical Pharmacy Shop</h1>
          <p className="mt-3 max-w-2xl text-sm text-blue-100 md:text-base">
            Choose your side first. Customers can browse and shop. Owners sign in with developer-provided accounts to manage the business.
          </p>
        </div>

        <div className="space-y-6 px-6 py-8 md:px-10">
          {session && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <div>
                <p className="text-sm font-semibold text-slate-800">You’re already signed in</p>
                <p className="text-xs text-slate-500">Continue to the {role === 'owner' ? 'owner dashboard' : 'customer shop'}, or sign out to switch accounts.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to={role === 'owner' ? '/owner' : '/shop'}
                  className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
                >
                  {role === 'owner' ? 'Open Owner Dashboard' : 'Open Customer Shop'}
                </Link>
                <button
                  className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  onClick={() => signOut()}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Customer side</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-800">Shop as a customer</h2>
              <p className="mt-2 text-sm text-slate-600">
                Sign in or sign up to browse products, add to cart, and use the customer AI assistant for product search and recommendations.
              </p>
              <div className="mt-4 flex gap-3">
                <Link to="/auth/customer" className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700">
                  Customer sign in / sign up
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Owner side</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-800">Sign in as owner</h2>
              <p className="mt-2 text-sm text-slate-600">
                Owner accounts are provided by the developer. Owners can access dashboard data, inventory, sales, and owner-side AI features.
              </p>
              <div className="mt-4 flex gap-3">
                <Link to="/auth/owner" className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100">
                  Owner sign in
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { mode } = useTheme();

  return (
    <div className={mode === 'dark' ? 'dark' : ''}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/auth/:audience" element={<AuthPage />} />
          <Route path="/login" element={<Navigate to="/auth/customer" replace />} />

          <Route
            path="/owner"
            element={
              <ProtectedRoute requireRole="owner">
                <OwnerShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<OwnerHome />} />
            <Route path="analytics" element={<OwnerDashboard />} />
            <Route path="fulfillment/:orderId" element={<FulfillmentOrderPage />} />
            <Route path="fulfillment" element={<FulfillmentPage />} />
            <Route path="chat" element={<OwnerChatInboxPage />} />
            <Route path="refunds" element={<RefundRequestsPage />} />
            <Route path="todo" element={<TodoPage />} />
            <Route path="crm" element={<CrmPage />} />
            <Route path="crm/patient/:patientId" element={<CrmPatientDetailPage />} />
            <Route path="sale" element={<SalePage />} />
            <Route path="sale/:orderId" element={<SaleOrderDetailPage />} />
            <Route path="purchase" element={<PurchasePage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="/shop" element={<ProtectedRoute><ShopPage /></ProtectedRoute>} />
          <Route path="/product/:productId" element={<ProtectedRoute><ProductDetailPage /></ProtectedRoute>} />
          <Route path="/account/address" element={<ProtectedRoute><AddressPage /></ProtectedRoute>} />
          <Route path="/account/patients" element={<ProtectedRoute><PatientsPage /></ProtectedRoute>} />
          <Route path="/account/payment" element={<ProtectedRoute><PaymentMethodsPage /></ProtectedRoute>} />
          <Route path="/account/payment/add-card" element={<ProtectedRoute><AddCardPage /></ProtectedRoute>} />
          <Route path="/checkout" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
          <Route path="/order-success/:orderId" element={<ProtectedRoute><OrderSuccessPage /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><MyOrdersPage /></ProtectedRoute>} />
          <Route path="/orders/:orderId" element={<ProtectedRoute><OrderTrackingPage /></ProtectedRoute>} />
          <Route path="/orders/:orderId/chat" element={<ProtectedRoute><OrderChatPage /></ProtectedRoute>} />
          <Route path="/inbox" element={<ProtectedRoute><CustomerInboxPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><CustomerProfilePage /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
