import { supabase } from './supabaseClient';

async function directAdjustProductStock(productId: number, delta: number) {
  const productRes = await supabase.from('products').select('id,name,stock').eq('id', productId).maybeSingle();
  if (productRes.error) throw productRes.error;
  if (!productRes.data) throw new Error(`Product #${productId} was not found.`);

  const currentStock = Number((productRes.data as any).stock || 0);
  const nextStock = currentStock + delta;
  if (nextStock < 0) {
    throw new Error(`Not enough stock for ${(productRes.data as any).name}.`);
  }

  const updateRes = await supabase
    .from('products')
    .update({ stock: nextStock })
    .eq('id', productId)
    .select('id,stock');
  if (updateRes.error) throw updateRes.error;
  const rows = Array.isArray(updateRes.data) ? updateRes.data : [];
  if (rows.length === 0) {
    throw new Error('Stock update was blocked by database permissions. Please apply the stock RPC SQL.');
  }
}

export async function adjustProductStock(productId: number, delta: number) {
  const rpc = await supabase.rpc('adjust_product_stock', {
    p_product_id: productId,
    p_delta: delta,
  });

  if (!rpc.error) return;

  // Fallback for environments where RPC is not installed yet.
  const msg = String(rpc.error.message || '').toLowerCase();
  if (msg.includes('function') && msg.includes('adjust_product_stock')) {
    await directAdjustProductStock(productId, delta);
    return;
  }

  throw rpc.error;
}

