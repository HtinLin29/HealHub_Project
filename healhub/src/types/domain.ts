export type UserRole = 'owner' | 'customer';

export interface Product {
  id: number;
  name: string;
  category?: string | null;
  description?: string | null;
  price: number;
  stock: number;
  low_stock_threshold: number;
  image_url?: string | null;
  is_active?: boolean | null;
}

export interface Order {
  id: number;
  customer_id?: string | null;
  patient_id?: number | null;
  customer_name?: string | null;
  total_price: number;
  status: 'pending' | 'paid' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
  created_at?: string;
}

export interface PatientProfile {
  id: number;
  full_name: string;
  age?: number | null;
  gender?: string | null;
  allergy?: string | null;
  is_default?: boolean;
}

export interface OrderItem {
  id?: number;
  order_id: number;
  product_id?: number | null;
  quantity: number;
  unit_price: number;
  line_total?: number;
}

export interface ProductReviewSummary {
  product_id: number;
  review_count: number;
  average_rating: number;
}

export interface ActivePromotion {
  promotion_id: number;
  promotion_name: string;
  description?: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  product_id: number;
}

export interface KpiSummary {
  /** All orders in database (any status). */
  totalOrders: number;
  /** Sum of order totals for paid / packed / shipped / delivered (same rule as monthly view). */
  totalRevenue: number;
  /** Sum of stock units across active products. */
  totalStock: number;
  /** Count of orders that contribute to totalRevenue. */
  revenueOrderCount: number;
  /** Orders awaiting payment. */
  pendingOrders: number;
  cancelledOrders: number;
  /** totalRevenue / revenueOrderCount when revenueOrderCount > 0. */
  avgOrderValue: number;
  /** Active catalog size. */
  activeProductCount: number;
}

export type AiConfidence = 'low' | 'medium' | 'high';
export type AiRiskLevel = 'low' | 'medium' | 'high';

export interface AiDemandForecastRow {
  productId: number;
  name: string;
  currentStock: number;
  predictedUnitsNext30: number;
  predictedRevenueNext30: number;
  confidence: AiConfidence;
  basedOn: string[];
}

export interface AiStockoutAlertRow {
  productId: number;
  name: string;
  currentStock: number;
  predictedDailyUnits: number;
  daysToStockout: number;
  riskLevel: AiRiskLevel;
  recommendedReorderQty: number;
}

export interface AiReorderSuggestionRow {
  productId: number;
  name: string;
  currentStock: number;
  suggestedQty: number;
  estimatedDaysCoverage: number;
  confidence: AiConfidence;
  reason: string;
}

export interface AiRunLogRow {
  id: string;
  action: string;
  status: 'applied' | 'skipped' | 'failed';
  message: string;
  createdAt: string;
  payload: Record<string, unknown>;
}
