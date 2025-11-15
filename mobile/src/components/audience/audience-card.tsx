/**
 * Audience Card Component
 * Display card for an individual audience
 */

import React from 'react';
import Link from 'next/link';
import { formatNumber, formatRelativeTime } from '../../../../shared/utils';
import { AudienceMetadata } from '../../../../shared/types';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Users, Calendar, RefreshCw } from 'lucide-react';

interface AudienceCardProps {
  audience: AudienceMetadata;
}

export const AudienceCard: React.FC<AudienceCardProps> = ({ audience }) => {
  return (
    <Link href={`/audience/${audience.id}`}>
      <Card hover padding="md" className="cursor-pointer">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                {audience.name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {formatRelativeTime(audience.createdAt)}
              </p>
            </div>
            <Badge status={audience.status} size="sm" />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center space-x-2">
              <Users size={16} className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Size</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {audience.size ? formatNumber(audience.size) : 'N/A'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <RefreshCw size={16} className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Refreshes</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {audience.refreshCount}
                </p>
              </div>
            </div>
          </div>

          {/* Last Refreshed */}
          {audience.lastRefreshed && (
            <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
              <Calendar size={14} />
              <span>Last refreshed {formatRelativeTime(audience.lastRefreshed)}</span>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
};

export default AudienceCard;
