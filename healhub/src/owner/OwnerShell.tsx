import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { readOwnerAiFeatureEnabled } from '../env';
import type { KpiSummary } from '../types/domain';
import type { OwnerAiPagePayload, OwnerShellOutletContext } from './ownerShellOutlet';

const OwnerAssistant = lazy(() => import('../components/OwnerAssistant'));

const ownerAiEnabled = readOwnerAiFeatureEnabled();

/** Empty snapshot for offline fallback when not on the analytics dashboard (server AI still uses live Supabase). */
const fallbackKpis: KpiSummary = {
  totalOrders: 0,
  totalRevenue: 0,
  totalStock: 0,
  revenueOrderCount: 0,
  pendingOrders: 0,
  cancelledOrders: 0,
  avgOrderValue: 0,
  activeProductCount: 0,
};

const emptyAssistantData: OwnerAiPagePayload = {
  kpis: fallbackKpis,
  products: [],
  recentOrders: [],
  monthlyRevenue: [],
};

/**
 * Wraps all `/owner/*` routes so Owner AI is available everywhere on the owner side.
 */
export default function OwnerShell() {
  const location = useLocation();
  const [liveAssistantData, setLiveAssistantData] = useState<OwnerAiPagePayload | null>(null);

  useEffect(() => {
    if (location.pathname !== '/owner/analytics') {
      setLiveAssistantData(null);
    }
  }, [location.pathname]);

  const registerOwnerAiPageData = useCallback((payload: OwnerAiPagePayload | null) => {
    setLiveAssistantData(payload);
  }, []);

  const outletContext: OwnerShellOutletContext = { registerOwnerAiPageData };
  const assistantProps = liveAssistantData ?? emptyAssistantData;

  return (
    <>
      <Outlet context={outletContext} />
      {ownerAiEnabled ? (
        <Suspense fallback={null}>
          <OwnerAssistant
            kpis={assistantProps.kpis}
            products={assistantProps.products}
            recentOrders={assistantProps.recentOrders}
            monthlyRevenue={assistantProps.monthlyRevenue}
          />
        </Suspense>
      ) : null}
    </>
  );
}
