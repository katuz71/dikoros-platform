import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { API_URL } from '../config/api';

export interface Variant {
  size: string;
  price: number;
}

export interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
  images?: string;  // Multiple images through comma separation
  image_url?: string;  // Alternative image field name from API/CSV
  picture?: string;  // Alternative image field name from API/XML
  description?: string;
  category?: string;
  // New fields
  weight?: string;
  composition?: string;
  usage?: string;
  pack_sizes?: string[] | string;  // Can be array or JSON string depending on source
  old_price?: number;  // For discount logic
  unit?: string;  // Measurement unit (e.g., "шт", "г", "мл")
  option_names?: string;  // Variation dimension titles (e.g., "weight|form|sort")
  variationGroups?: any[];  // Advanced variation groups (multi-dimensional)
  variants?: any;  // Variants with different prices (can be array or JSON string)
  available?: boolean | string | number;
  in_stock?: boolean | string | number;
  stock?: boolean | string | number;
  quantity?: boolean | string | number;
  balance?: boolean | string | number;
  presence?: string;
  status?: string;
}

export type OrderItem = {
  id: number;
  name: string;
  price: number;
  image: string;
  quantity: number;
  packSize: string; // Changed to string to support "30", "60"
  variant_info?: string | null; // Variant size information (e.g., "10 шт", "100 г")
};

export type Order = {
  id: string;
  date: string;
  items: OrderItem[];
  total: number;
  city?: string;
  warehouse?: string;
  phone?: string;
  name?: string;
  user_name?: string; // Added for server sync
};

interface OrdersContextType {
  // Product Data
  products: Product[];
  fetchProducts: () => Promise<void>;
  isLoading: boolean;
  
  // Order Data
  orders: Order[];
  addOrder: (order: Order) => void;
  removeOrder: (id: string) => void;
  clearOrders: () => void;
}

const OrdersContext = createContext<OrdersContextType>({
  products: [],
  fetchProducts: async () => {},
  isLoading: false,
  orders: [],
  addOrder: () => {},
  removeOrder: () => {},
  clearOrders: () => {},
});

const PRODUCTS_CACHE_KEY = 'cached_products_v4';
const PRODUCTS_CACHE_MAX_SIZE = 1_500_000;
const PRODUCTS_TIMEOUT_MS = 15000;

const isProductAvailable = (product: Product): boolean => {
  const negativeStrings = [
    '0',
    'false',
    'no',
    'none',
    'out_of_stock',
    'not_available',
    'unavailable',
    'немає',
    'нет',
    'відсутній',
    'відсутня',
    'не в наявності',
    'нет в наличии',
  ];

  const positiveStrings = [
    '1',
    'true',
    'yes',
    'available',
    'in_stock',
    'in stock',
    'в наявності',
    'есть',
    'є',
  ];

  const checkValue = (value: unknown): boolean | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;

    const normalized = String(value).trim().toLowerCase();

    if (positiveStrings.includes(normalized)) return true;
    if (negativeStrings.includes(normalized)) return false;

    const numeric = Number(normalized);
    if (!Number.isNaN(numeric)) return numeric > 0;

    return null;
  };

  const fields = [
    product.available,
    product.in_stock,
    product.stock,
    product.quantity,
    product.balance,
    product.presence,
    product.status,
  ];

  for (const field of fields) {
    const result = checkValue(field);
    if (result !== null) return result;
  }

  return true;
};

const parseProductsPayload = (data: any): Product[] => {
  const productsArray = Array.isArray(data)
    ? data
    : Array.isArray(data?.products)
      ? data.products
      : [];

  // Availability is displayed/blocked in UI, but products must not disappear.
  return productsArray;
};

export const OrdersProvider = ({ children }: { children: ReactNode }) => {
  // --- PRODUCTS STATE ---
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProducts = async () => {
    let usedCachedProducts = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      setIsLoading(true);

      try {
        const cachedData = await AsyncStorage.getItem(PRODUCTS_CACHE_KEY);
        if (cachedData) {
          const cachedProducts = JSON.parse(cachedData);
          if (Array.isArray(cachedProducts) && cachedProducts.length > 0) {
            setProducts(cachedProducts);
            usedCachedProducts = true;
            setIsLoading(false);
          }
        }
      } catch (cacheError) {
        console.warn('Product cache read failed:', cacheError);
        try {
          await AsyncStorage.removeItem(PRODUCTS_CACHE_KEY);
        } catch {}
      }

      const productsUrl = `${API_URL}/products?limit=500`;
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), PRODUCTS_TIMEOUT_MS);

      const response = await fetch(productsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (!response.ok) {
        throw new Error(`products HTTP ${response.status}`);
      }

      const data = await response.json();
      const productsArray = parseProductsPayload(data);

      if (productsArray.length > 0) {
        setProducts(productsArray);

        try {
          const serialized = JSON.stringify(productsArray);
          if (serialized.length < PRODUCTS_CACHE_MAX_SIZE) {
            await AsyncStorage.setItem(PRODUCTS_CACHE_KEY, serialized);
          }
        } catch (cacheError) {
          console.warn('Product cache save failed:', cacheError);
        }
      }
    } catch (error: any) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (error?.name === 'AbortError') {
        console.warn('⏱️ Products request timeout, keeping cached products if available');
      } else {
        console.warn('Products fetch failed, keeping cached products if available:', error?.message || error);
      }

      if (!usedCachedProducts && products.length === 0) {
        setProducts([]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Load products on startup
  useEffect(() => {
    fetchProducts();
  }, []);

  // --- ORDERS STATE ---
  const [orders, setOrders] = useState<Order[]>([]);

  const addOrder = (order: Order) => {
    setOrders((prev: Order[]) => [order, ...prev]);
  };

  const removeOrder = (id: string) => {
    setOrders((prev: Order[]) => prev.filter((o: Order) => o.id !== id));
  };

  const clearOrders = () => {
    setOrders([]);
  };

  return (
    <OrdersContext.Provider value={{ 
      products, fetchProducts, isLoading,
      orders, addOrder, removeOrder, clearOrders 
    }}>
      {children}
    </OrdersContext.Provider>
  );
};

export const useOrders = () => useContext(OrdersContext);
