import { View, Text, StyleSheet } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>HealHub</Text>
      <Text style={styles.subtitle}>Native Expo app (Option B)</Text>
      <Text style={styles.body}>
        Next we will migrate your web features here: Shop → Cart → Checkout → Orders → Chat → Delivery.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#f8fafc' },
  title: { fontSize: 28, fontWeight: '800', color: '#0f172a' },
  subtitle: { marginTop: 6, fontSize: 14, color: '#475569' },
  body: { marginTop: 16, fontSize: 14, color: '#334155', lineHeight: 20 },
});

