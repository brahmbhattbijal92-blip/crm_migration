'use client';

import React, { createContext, useContext, useSyncExternalStore } from 'react';

export type StoragePreference = 'local' | 'cloud';

export interface StorageContextType {
  /** Global storage target preference indicating whether queries/mutations route locally or to cloud endpoints */
  storagePreference: StoragePreference;
  /** Indicates asynchronous transition state when switching storage providers */
  isPending: boolean;
  /** Updates the global storage preference across local storage and application state */
  updateStoragePreference: (preference: StoragePreference) => Promise<void>;
}

const STORAGE_PREF_KEY = 'crm_migration_storage_pref';
const STORAGE_PREF_EVENT = 'crm-storage-preference-update';
const StorageContext = createContext<StorageContextType | undefined>(undefined);

const readStoragePreference = (): StoragePreference => {
  if (typeof window === 'undefined') return 'local';
  const saved = window.localStorage.getItem(STORAGE_PREF_KEY);
  return saved === 'cloud' || saved === 'local' ? saved : 'local';
};

const subscribeStoragePreference = (callback: () => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('storage', callback);
  window.addEventListener(STORAGE_PREF_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(STORAGE_PREF_EVENT, callback);
  };
};

const getServerStoragePreference = (): StoragePreference => 'local';

export const StorageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storagePreference = useSyncExternalStore(
    subscribeStoragePreference,
    readStoragePreference,
    getServerStoragePreference
  );

  const updateStoragePreference = async (preference: StoragePreference) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_PREF_KEY, preference);
      window.dispatchEvent(new Event(STORAGE_PREF_EVENT));
    }
  };

  return (
    <StorageContext.Provider value={{ storagePreference, isPending: false, updateStoragePreference }}>
      {children}
    </StorageContext.Provider>
  );
};

export const useStorage = (): StorageContextType => {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error('useStorage must be executed inside a <StorageProvider>');
  }
  return context;
};
