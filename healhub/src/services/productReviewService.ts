import { supabase } from './supabaseClient';
import { getOrCreateCurrentCustomerId } from './customerIdentityService';

export type ProductReview = {
  id: number;
  product_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  customer_name: string | null;
};

/** Review row plus product name for owner dashboards (e.g. Surveys). */
export type ProductReviewFeedItem = ProductReview & {
  product_name: string | null;
};

/**
 * Latest product reviews across the catalog, with product names (for owner Surveys / feedback).
 */
export async function listProductReviewsForOwner(limit = 200): Promise<ProductReviewFeedItem[]> {
  const base = await supabase
    .from('product_reviews')
    .select('id,product_id,rating,comment,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (base.error) {
    const fallback = await supabase
      .from('product_reviews')
      .select('id,product_id,rating,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fallback.error) throw fallback.error;
    return enrichWithProductNames(
      (fallback.data ?? []).map((row: any) => ({
        id: Number(row.id),
        product_id: Number(row.product_id),
        rating: Number(row.rating || 0),
        comment: null,
        created_at: String(row.created_at || ''),
        customer_name: null,
      })),
    );
  }

  const rows = (base.data ?? []).map((row: any) => ({
    id: Number(row.id),
    product_id: Number(row.product_id),
    rating: Number(row.rating || 0),
    comment: row.comment != null && String(row.comment).trim() !== '' ? String(row.comment) : null,
    created_at: String(row.created_at || ''),
    customer_name: null,
  }));

  return enrichWithProductNames(rows);
}

async function enrichWithProductNames(rows: ProductReview[]): Promise<ProductReviewFeedItem[]> {
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.product_id))];
  const { data: prods, error } = await supabase.from('products').select('id,name').in('id', ids);
  if (error) {
    return rows.map((r) => ({ ...r, product_name: null }));
  }
  const nameById = new Map<number, string>();
  for (const p of prods ?? []) {
    const id = Number((p as { id?: unknown }).id);
    const name = (p as { name?: unknown }).name;
    if (Number.isFinite(id) && typeof name === 'string') nameById.set(id, name);
  }
  return rows.map((r) => ({
    ...r,
    product_name: nameById.get(r.product_id) ?? null,
  }));
}

export async function listRecentProductReviews(productId: number, limit = 6): Promise<ProductReview[]> {
  const withComment = await supabase
    .from('product_reviews')
    .select('id,product_id,rating,comment,created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!withComment.error) {
    return (withComment.data ?? []).map((row: any) => ({
      id: Number(row.id),
      product_id: Number(row.product_id),
      rating: Number(row.rating || 0),
      comment: row.comment ?? null,
      created_at: String(row.created_at || ''),
      customer_name: null,
    }));
  }

  const fallback = await supabase
    .from('product_reviews')
    .select('id,product_id,rating,created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (fallback.error) throw fallback.error;

  return (fallback.data ?? []).map((row: any) => ({
    id: Number(row.id),
    product_id: Number(row.product_id),
    rating: Number(row.rating || 0),
    comment: null,
    created_at: String(row.created_at || ''),
    customer_name: null,
  }));
}

export async function submitProductReview(productId: number, rating: number, comment: string) {
  void getOrCreateCurrentCustomerId;

  const normalizedRating = Math.max(1, Math.min(5, Number(rating || 0)));
  if (!Number.isFinite(normalizedRating)) throw new Error('Invalid rating.');

  const trimmedComment = String(comment || '').trim();
  const withComment = await supabase.from('product_reviews').insert({
    product_id: productId,
    rating: normalizedRating,
    comment: trimmedComment || '',
  });
  if (!withComment.error) return;

  const fallback = await supabase.from('product_reviews').insert({
    product_id: productId,
    rating: normalizedRating,
  });
  if (fallback.error) throw fallback.error;
}

