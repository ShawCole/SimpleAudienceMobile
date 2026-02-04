/**
 * Audiences Hook
 * React hook for fetching and managing audiences with Zustand
 */

import { useEffect } from 'react';
import { useAudienceStore } from '../store/useAudienceStore';

export function useAudiences(page: number = 1, pageSize: number = 20) {
  const {
    audiences,
    totalAudiences,
    isLoading,
    error,
    fetchAudiences
  } = useAudienceStore();

  useEffect(() => {
    // Initial fetch
    fetchAudiences(page, pageSize);

    // RESTORE POLLING: Re-fetch every 5 seconds to update "Processing" status
    const interval = setInterval(() => {
      fetchAudiences(page, pageSize);
    }, 5000);

    return () => clearInterval(interval);
  }, [page, pageSize, fetchAudiences]);

  return {
    audiences,
    total: totalAudiences,
    isLoading,
    error,
    mutate: () => fetchAudiences(page, pageSize), // Manual refresh trigger
  };
}

export function useAudience(id: string | null) {
  const {
    currentAudience,
    isLoading,
    error,
    fetchAudienceById
  } = useAudienceStore();

  useEffect(() => {
    if (id) {
      fetchAudienceById(id);
    }
  }, [id, fetchAudienceById]);

  return {
    audience: currentAudience,
    isLoading,
    error,
    mutate: () => id && fetchAudienceById(id),
  };
}
