/**
 * Home Page - Audience Dashboard
 * Main landing page showing all audiences
 */

'use client';

import React from 'react';
import { Header } from '../components/layout/header';
import { AudienceCard } from '../components/audience/audience-card';
import { Button } from '../components/ui/button';
import { useAudiences } from '../hooks/use-audiences';
import { Loader2, AlertCircle } from 'lucide-react';

export default function HomePage() {
  const { audiences, isLoading, error } = useAudiences();

  return (
    <div className="min-h-screen">
      <Header title="My Audiences" />

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="animate-spin text-primary-600" size={48} />
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              Loading audiences...
            </p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="text-red-600" size={48} />
            <p className="mt-4 text-red-600">Failed to load audiences</p>
            <p className="text-sm text-gray-500 mt-2">
              {error.message || 'Please try again later'}
            </p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && audiences.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                No audiences yet
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Create your first audience to get started
              </p>
              <Button variant="primary" size="lg" onClick={() => window.location.href = '/create'}>
                Create Audience
              </Button>
            </div>
          </div>
        )}

        {/* Audiences Grid */}
        {!isLoading && !error && audiences.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                All Audiences ({audiences.length})
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {audiences.map((audience) => (
                <AudienceCard key={audience.id} audience={audience} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
