import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { checkServerHealth, getConnectionErrorMessage } from '../utils/serverCheck';
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

export const OrdersProvider = ({ children }: { children: ReactNode }) => {
  // --- PRODUCTS STATE ---
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      
      // Сначала проверяем доступность сервера
      const serverAvailable = await checkServerHealth();
      if (!serverAvailable) {
        console.error("❌ Server is not available at", API_URL);
        console.error(getConnectionErrorMessage());
        setProducts([]);
        setIsLoading(false);
        return;
      }
      
      const productsUrl = `${API_URL}/products`;
      console.log("🔥 TRYING TO FETCH:", productsUrl);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд timeout
      
      const response = await fetch(productsUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("Products response:", data);

      const productsArray = Array.isArray(data)
        ? data
        : Array.isArray(data?.products)
          ? data.products
          : [];

      console.log("Products loaded:", productsArray.length);

      if (productsArray.length > 0 && productsArray[0]) {
        console.log("First product sample:", {
          id: productsArray[0].id,
          name: productsArray[0].name,
          hasVariants: 'variants' in productsArray[0],
          variants: productsArray[0].variants,
          variantsType: typeof productsArray[0].variants,
          hasImages: 'images' in productsArray[0],
          images: productsArray[0].images,
          imagesType: typeof productsArray[0].images,
          image: productsArray[0].image,
          picture: productsArray[0].picture
        });
      }

      setProducts(productsArray);
    } catch (error: any) {
      console.error("🔥 FETCH ERROR:", error);
      console.error("Error fetching products:", error);
      console.error("Error details:", {
        message: error.message,
        name: error.name,
        type: typeof error,
        stack: error.stack
      });
      
      // More detailed error logging
      if (error.name === 'AbortError') {
        console.error("⏱️ Request timeout - Server is too slow to respond");
      } else if (error.message?.includes('Network request failed') || error.message?.includes('Failed to fetch')) {
        console.error("🌐 Network error - Server may not be running");
        console.error(getConnectionErrorMessage());
      }
      
      // Ensure products is always an array even on error
      setProducts([]);
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
