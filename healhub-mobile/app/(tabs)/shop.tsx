import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../src/lib/supabase';

type Product = {
  id: number;
  name: string;
  price: number;
  stock: number;
  low_stock_threshold: number;
};

export default function ShopScreen() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);

  async function load() {
    setLoading(true);
    const res = await supabase
      .from('products')
      .select('id,name,price,stock,low_stock_threshold')
      .eq('is_active', true)
      .order('id', { ascending: false })
      .limit(200);
    if (res.error) {
      setError(res.error.message);
      setProducts([]);
      setLoading(false);
      return;
    }
    setProducts(
      (res.data ?? []).map((p: any) => ({
        id: Number(p.id),
        name: String(p.name || ''),
        price: Number(p.price ?? 0),
        stock: Number(p.stock ?? 0),
        low_stock_threshold: Number(p.low_stock_threshold ?? 10),
      })),
    );
    setError('');
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, query]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Shop</Text>
      <Text style={styles.subtitle}>Loaded from Supabase (native Expo).</Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search products…"
        style={styles.search}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.hint}>Loading…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.meta}>Stock: {item.stock}</Text>
              </View>
              <Text style={styles.price}>฿{item.price.toFixed(2)}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#f8fafc' },
  title: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  subtitle: { marginTop: 8, fontSize: 14, color: '#475569' },
  search: {
    marginTop: 14,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  center: { paddingTop: 20, alignItems: 'center', gap: 8 },
  hint: { color: '#64748b' },
  error: { color: '#b91c1c', textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  name: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  meta: { marginTop: 4, fontSize: 12, color: '#64748b' },
  price: { fontSize: 14, fontWeight: '800', color: '#4f46e5' },
});

