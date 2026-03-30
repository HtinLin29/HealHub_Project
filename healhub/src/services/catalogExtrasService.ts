import { supabase } from './supabaseClient';
import type { ActivePromotion, ProductReviewSummary } from '../types/domain';

export async function fetchReviewSummaries(): Promise<ProductReviewSummary[]> {
  const { data, error } = await supabase.from('product_review_summary').select('product_id,review_count,average_rating');
  if (error) return [];
  return (data || []).map((r: any) => ({
    product_id: Number(r.product_id),
    review_count: Number(r.review_count || 0),
    average_rating: Number(r.average_rating || 0),
  }));
}

export async function fetchActivePromotions(): Promise<ActivePromotion[]> {
  const { data, error } = await supabase.from('active_product_promotions').select('promotion_id,promotion_name,description,discount_type,discount_value,product_id');
  if (error) return [];
  return (data || []).map((r: any) => ({
    promotion_id: Number(r.promotion_id),
    promotion_name: r.promotion_name,
    description: r.description ?? null,
    discount_type: r.discount_type,
    discount_value: Number(r.discount_value || 0),
    product_id: Number(r.product_id),
  }));
}

export function getDiscountedPrice(price: number, promo?: ActivePromotion | null) {
  if (!promo) return Number(price);
  if (promo.discount_type === 'percent') {
    return Math.max(0, Number(price) * (1 - Number(promo.discount_value) / 100));
  }
  return Math.max(0, Number(price) - Number(promo.discount_value));
}
