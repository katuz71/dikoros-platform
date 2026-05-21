import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

interface ProductImageProps {
  uri?: string;
  uris?: string[];
  cacheKey?: string | number;
  style?: any;
  size?: number;
  contentFit?: 'cover' | 'contain';
}

const preferredIndexByKey = new Map<string, number>();

export default function ProductImage({ uri, uris, cacheKey, style, size = 200, contentFit = 'cover' }: ProductImageProps) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  const key = cacheKey === 0 || cacheKey ? String(cacheKey) : '';

  const candidates = React.useMemo(() => {
    const out: string[] = [];

    const push = (v: any) => {
      const s = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
      if (!s || s === 'null' || s === 'undefined') return;
      out.push(s);
    };

    if (Array.isArray(uris)) {
      (uris as any[]).forEach(push);
    }

    if (typeof uri === 'string') {
      const s = uri.trim();
      if (s.startsWith('[') && s.endsWith(']')) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) parsed.forEach(push);
          else push(s);
        } catch {
          push(s);
        }
      } else {
        push(s);
      }
    }

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const u of out) {
      const norm = u.replace(/\s+/g, '%20');
      if (seen.has(norm)) continue;
      seen.add(norm);
      deduped.push(norm);
    }
    return deduped;
  }, [uri, uris]);

  const candidatesKey = React.useMemo(() => candidates.join('|'), [candidates]);

  const [idx, setIdx] = React.useState(() => {
    if (!key) return 0;
    const saved = preferredIndexByKey.get(key);
    return typeof saved === 'number' && saved >= 0 ? saved : 0;
  });

  React.useEffect(() => {
    const saved = key ? preferredIndexByKey.get(key) : undefined;
    const next = typeof saved === 'number' && saved >= 0 && saved < candidates.length ? saved : 0;
    setIdx(next);
  }, [candidatesKey, candidates.length, key]);

  const imageUri = candidates[idx] || null;

  // console.log('🖼️ ProductImage rendered with uri:', imageUri);

  // Важно: не даём компоненту "залипнуть" в error=true.
  // Если uri стал валидным (например, данные догрузились) — пробуем снова.
  React.useEffect(() => {
    if (!imageUri) {
      setLoading(false);
      setError(true);
      return;
    }
    setError(false);
    setLoading(true);
  }, [imageUri]);

  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      {loading && !error && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#999" />
        </View>
      )}
      
      {!imageUri ? (
        <View style={styles.errorContainer}>
          <Ionicons name="image-outline" size={32} color="#ccc" />
        </View>
      ) : (
        <Image
          source={imageUri}
          style={StyleSheet.absoluteFillObject}
          contentFit={contentFit}
          cachePolicy="disk"
          onLoadStart={() => {
            console.log('🖼️ Image load start:', imageUri);
            setLoading(true);
            setError(false);
          }}
          onLoad={() => {
            console.log('🖼️ Image load end:', imageUri);
            setLoading(false);
            if (key) preferredIndexByKey.set(key, idx);
          }}
          onLoadEnd={() => {
            setLoading(false);
          }}
          onError={(errorEvent) => {
            const err = (errorEvent as any)?.error || (errorEvent as any)?.nativeEvent?.error || 'Unknown error';
            console.error('🖼️ Image load error:', imageUri, err);
            if (idx < candidates.length - 1) {
              const nextIdx = idx + 1;
              if (key) preferredIndexByKey.set(key, nextIdx);
              setIdx(nextIdx);
              setError(false);
              setLoading(true);
              return;
            }
            setLoading(false);
            setError(true);
          }}
        />
      )}

      {error && !!imageUri && (
        <View style={styles.errorOverlay}>
          <Ionicons name="image-outline" size={32} color="#ccc" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
});
