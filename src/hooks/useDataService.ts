'use client';

import { useMemo } from 'react';
import { useStorage } from '../context/StorageContext';
import { DataService } from '../services/DataService';
import { LocalDataService } from '../services/LocalDataService';
import { CloudDataService } from '../services/CloudDataService';
import { DataServiceFallbackWrapper } from '../services/DataServiceFallbackWrapper';

export const useDataService = (): DataService => {
  const { storagePreference } = useStorage();

  return useMemo(() => {
    const local = new LocalDataService();
    const cloud = new CloudDataService();
    
    // Pass a getter function so the wrapper always reads the live, current preference value
    return new DataServiceFallbackWrapper(cloud, local, () => storagePreference);
  }, [storagePreference]);
};
