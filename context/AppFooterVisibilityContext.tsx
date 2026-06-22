import React, { createContext, useContext } from 'react';

type AppFooterVisibilityValue = {
  productFooterVisible: boolean;
  setProductFooterVisible: (visible: boolean) => void;
};

const AppFooterVisibilityContext = createContext<AppFooterVisibilityValue>({
  productFooterVisible: true,
  setProductFooterVisible: () => {},
});

export const AppFooterVisibilityProvider = AppFooterVisibilityContext.Provider;

export const useAppFooterVisibility = () => useContext(AppFooterVisibilityContext);
