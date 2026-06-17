import React, { createContext, ReactNode, useContext, useState } from 'react';

type GlobalSearchContextType = {
  visible: boolean;
  openSearch: () => void;
  closeSearch: () => void;
};

const GlobalSearchContext = createContext<GlobalSearchContextType>({
  visible: false,
  openSearch: () => {},
  closeSearch: () => {},
});

export const GlobalSearchProvider = ({ children }: { children: ReactNode }) => {
  const [visible, setVisible] = useState(false);

  return (
    <GlobalSearchContext.Provider
      value={{
        visible,
        openSearch: () => setVisible(true),
        closeSearch: () => setVisible(false),
      }}
    >
      {children}
    </GlobalSearchContext.Provider>
  );
};

export const useGlobalSearch = () => useContext(GlobalSearchContext);
