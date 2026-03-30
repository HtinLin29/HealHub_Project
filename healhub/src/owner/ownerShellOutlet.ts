import type { KpiSummary, Order, Product } from '../types/domain';

/** Live stats pushed from owner pages (e.g. Analytics) into the floating Owner Assistant. */
export type OwnerAiPagePayload = {
  kpis: KpiSummary;
  products: Product[];
  recentOrders: Order[];
  monthlyRevenue: { month: string; revenue: number }[];
};

export type OwnerShellOutletContext = {
  registerOwnerAiPageData: (payload: OwnerAiPagePayload | null) => void;
};
