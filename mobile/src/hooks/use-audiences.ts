/**
 * Audiences Hook
 * React hook for fetching and managing audiences with SWR
 */

import useSWR from 'swr';
import { apiClient } from '../services/api-client';
import { AudienceMetadata } from '../../../shared/types';

export function useAudiences(page: number = 1, pageSize: number = 20) {
  const { data, error, isLoading, mutate } = useSWR(
    `/audiences?page=${page}&pageSize=${pageSize}`,
    () => apiClient.getAudiences(page, pageSize),
    {
      refreshInterval: 5000, // Refresh every 5 seconds to update status
      revalidateOnFocus: true,
    }
  );

  return {
    audiences: data?.audiences || [],
    total: data?.total || 0,
    isLoading,
    error,
    mutate,
  };
}

export function useAudience(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/audiences/${id}` : null,
    () => (id ? apiClient.getAudience(id) : null),
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
    }
  );

  return {
    audience: data,
    isLoading,
    error,
    mutate,
  };
}
