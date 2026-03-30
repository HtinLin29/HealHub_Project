import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';

function buildTimeHealhubUrlMisconfigured(url: string): string | null {
  if (!Device.isDevice) return null;
  if (/127\.0\.0\.1|localhost/i.test(url) || url.includes('10.0.2.2')) {
    return `Invalid HealHub URL for a real device: ${url}. Set EXPO_PUBLIC_HEALHUB_URL (EAS Environment Variables for APK builds — see healhub-mobile/.env.example).`;
  }
  return null;
}

/**
 * HealHub web URL:
 * - Set `EXPO_PUBLIC_HEALHUB_URL` in `.env` (e.g. http://192.168.1.5:5173) for a fixed dev machine.
 * - Simulators: Android uses 10.0.2.2, iOS uses localhost (HealHub must run: `npm run dev` in healhub).
 * - Physical device: uses Metro host IP + port 5173 (same PC as Expo; allow LAN in Windows Firewall).
 */
function resolveHealhubUrl(): string {
  // Direct process.env.EXPO_PUBLIC_* (no ?. on env) so Expo can inline values in EAS/release bundles.
  const fromEnv = String(process.env.EXPO_PUBLIC_HEALHUB_URL ?? '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  if (Platform.OS === 'android' && !Device.isDevice) {
    return 'http://10.0.2.2:5173';
  }
  if (Platform.OS === 'ios' && !Device.isDevice) {
    return 'http://localhost:5173';
  }

  const hostUri = (Constants as { expoConfig?: { hostUri?: string }; hostUri?: string })?.expoConfig?.hostUri
    ?? (Constants as { hostUri?: string }).hostUri
    ?? '';
  const host = String(hostUri).split(':')[0];
  if (host && host !== 'localhost') return `http://${host}:5173`;
  return 'http://127.0.0.1:5173';
}

export default function App() {
  const url = useMemo(() => resolveHealhubUrl(), []);
  const urlConfigError = useMemo(() => buildTimeHealhubUrlMisconfigured(url), [url]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (urlConfigError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{urlConfigError}</Text>
          <Text style={styles.errorHint}>
            Rebuild the APK after setting EXPO_PUBLIC_HEALHUB_URL (and Supabase EXPO_PUBLIC_* if needed) in the Expo dashboard or EAS secrets.
          </Text>
        </View>
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.webWrap}>
        <WebView
          source={{ uri: url }}
          domStorageEnabled
          thirdPartyCookiesEnabled
          onLoadStart={() => {
            setLoading(true);
            setError(null);
          }}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(navState) => {
            if (!navState.loading) {
              setLoading(false);
            }
          }}
          onError={(e) => {
            setLoading(false);
            setError(`Failed to load: ${String(e.nativeEvent?.description || 'Unknown error')}`);
          }}
          onHttpError={(e) => {
            setLoading(false);
            const status = e.nativeEvent?.statusCode;
            setError(
              status
                ? `Web server returned ${status}. Is healhub Vite running? (${url})`
                : `Could not open HealHub page. (${url})`,
            );
          }}
          originWhitelist={['*']}
          allowsInlineMediaPlayback
          allowsBackForwardNavigationGestures={Platform.OS === 'ios'}
        />

        {loading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#4f46e5" />
            <Text style={styles.loadingText}>Loading HealHub…</Text>
          </View>
        )}

        {error ? (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorHint}>Set EXPO_PUBLIC_HEALHUB_URL in healhub-mobile/.env and restart Expo.</Text>
          </View>
        ) : null}
      </View>

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(254,242,242,0.98)',
  },
  errorText: {
    color: '#991b1b',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorHint: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
  },
});
