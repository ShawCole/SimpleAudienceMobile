/**
 * Audience Detail Page
 * View and manage individual audience
 */

'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Header } from '../../../components/layout/header';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { useAudience } from '../../../hooks/use-audiences';
import { apiClient } from '../../../services/api-client';
import toast from 'react-hot-toast';
import { formatNumber, formatRelativeTime } from '../../../../../shared/utils';
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Download,
  Copy,
  Trash2,
  Users,
  Calendar,
} from 'lucide-react';

export default function AudienceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { audience, isLoading, error, mutate } = useAudience(id);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleRefresh = async () => {
    setActionLoading('refresh');
    try {
      await apiClient.refreshAudience(id);
      toast.success('Audience refresh started');
      mutate();
    } catch (error) {
      toast.error('Failed to refresh audience');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDuplicate = async () => {
    const newName = prompt('Enter name for duplicated audience:');
    if (!newName) return;

    setActionLoading('duplicate');
    try {
      const newAudience = await apiClient.duplicateAudience(id, newName);
      toast.success('Audience duplicated successfully');
      router.push(`/audience/${newAudience.id}`);
    } catch (error) {
      toast.error('Failed to duplicate audience');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this audience? This action cannot be undone.')) {
      return;
    }

    setActionLoading('delete');
    try {
      await apiClient.deleteAudience(id);
      toast.success('Audience deleted successfully');
      router.push('/');
    } catch (error) {
      toast.error('Failed to delete audience');
      setActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header showCreateButton={false} />
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary-600" size={48} />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading audience...</p>
        </div>
      </div>
    );
  }

  if (error || !audience) {
    return (
      <div className="min-h-screen">
        <Header showCreateButton={false} />
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="text-red-600" size={48} />
          <p className="mt-4 text-red-600">Audience not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Audience Details" showCreateButton={false} />

      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
        {/* Header Card */}
        <Card padding="lg">
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  {audience.name}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Created {formatRelativeTime(audience.createdAt)}
                </p>
              </div>
              <Badge status={audience.status} size="md" />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <Users className="text-gray-400" size={24} />
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Audience Size</p>
                  <p className="text-xl font-semibold text-gray-900 dark:text-white">
                    {audience.size ? formatNumber(audience.size) : 'N/A'}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <RefreshCw className="text-gray-400" size={24} />
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Refresh Count</p>
                  <p className="text-xl font-semibold text-gray-900 dark:text-white">
                    {audience.refreshCount}
                  </p>
                </div>
              </div>
            </div>

            {audience.lastRefreshed && (
              <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                <Calendar size={16} />
                <span>Last refreshed {formatRelativeTime(audience.lastRefreshed)}</span>
              </div>
            )}
          </div>
        </Card>

        {/* Filters Card */}
        <Card padding="lg">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Filters
          </h2>

          <div className="space-y-4">
            {audience.filters.location && (
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Location
                </p>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  {audience.filters.location.cities && (
                    <p>Cities: {audience.filters.location.cities.join(', ')}</p>
                  )}
                  {audience.filters.location.states && (
                    <p>States: {audience.filters.location.states.join(', ')}</p>
                  )}
                  {audience.filters.location.zipCodes && (
                    <p>ZIP Codes: {audience.filters.location.zipCodes.join(', ')}</p>
                  )}
                </div>
              </div>
            )}

            {audience.filters.intent && (
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Intent
                </p>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <p>Type: {audience.filters.intent.type}</p>
                  {audience.filters.intent.keywords && (
                    <p>Keywords: {audience.filters.intent.keywords.join(', ')}</p>
                  )}
                  {audience.filters.intent.score && (
                    <p>Score: {audience.filters.intent.score}</p>
                  )}
                </div>
              </div>
            )}

            {!audience.filters.location && !audience.filters.intent && (
              <p className="text-sm text-gray-500 dark:text-gray-400">No filters applied</p>
            )}
          </div>
        </Card>

        {/* Actions */}
        <div className="space-y-3">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleRefresh}
            loading={actionLoading === 'refresh'}
            disabled={actionLoading !== null}
          >
            <RefreshCw size={20} className="mr-2" />
            Refresh Audience
          </Button>

          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={handleDuplicate}
            loading={actionLoading === 'duplicate'}
            disabled={actionLoading !== null}
          >
            <Copy size={20} className="mr-2" />
            Duplicate
          </Button>

          <Button
            variant="danger"
            size="lg"
            fullWidth
            onClick={handleDelete}
            loading={actionLoading === 'delete'}
            disabled={actionLoading !== null}
          >
            <Trash2 size={20} className="mr-2" />
            Delete Audience
          </Button>
        </div>
      </main>
    </div>
  );
}
