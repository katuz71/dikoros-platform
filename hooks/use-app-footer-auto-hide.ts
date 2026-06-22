import { useAppFooterVisibility } from '@/context/AppFooterVisibilityContext';
import { useCallback, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

export const useAppFooterAutoHide = () => {
  const { productFooterVisible, setProductFooterVisible } = useAppFooterVisibility();
  const footerVisibleRef = useRef(productFooterVisible);
  const lastScrollOffsetRef = useRef(0);
  const scrollDirectionRef = useRef<'up' | 'down' | null>(null);
  const directionDistanceRef = useRef(0);

  useEffect(() => {
    footerVisibleRef.current = productFooterVisible;
  }, [productFooterVisible]);

  const updateFooterVisibility = useCallback((visible: boolean) => {
    if (footerVisibleRef.current === visible) return;
    footerVisibleRef.current = visible;
    setProductFooterVisible(visible);
  }, [setProductFooterVisible]);

  useEffect(() => {
    updateFooterVisibility(true);
    return () => setProductFooterVisible(true);
  }, [setProductFooterVisible, updateFooterVisibility]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = offset - lastScrollOffsetRef.current;
    lastScrollOffsetRef.current = offset;

    if (offset <= 8) {
      scrollDirectionRef.current = null;
      directionDistanceRef.current = 0;
      updateFooterVisibility(true);
      return;
    }

    if (Math.abs(delta) < 1) return;
    const direction: 'up' | 'down' = delta > 0 ? 'down' : 'up';

    if (scrollDirectionRef.current !== direction) {
      scrollDirectionRef.current = direction;
      directionDistanceRef.current = 0;
    }
    directionDistanceRef.current += Math.abs(delta);

    if (direction === 'down' && offset > 24 && directionDistanceRef.current >= 18) {
      directionDistanceRef.current = 0;
      updateFooterVisibility(false);
    } else if (direction === 'up' && directionDistanceRef.current >= 14) {
      directionDistanceRef.current = 0;
      updateFooterVisibility(true);
    }
  }, [updateFooterVisibility]);

  return {
    footerVisible: productFooterVisible,
    handleFooterScroll: handleScroll,
  };
};
