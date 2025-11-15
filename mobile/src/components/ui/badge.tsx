/**
 * Badge Component
 * Status indicator badge
 */

import React from 'react';
import clsx from 'clsx';
import { AudienceStatus } from '../../../../shared/types';

interface BadgeProps {
  status: AudienceStatus | string;
  size?: 'sm' | 'md' | 'lg';
}

export const Badge: React.FC<BadgeProps> = ({ status, size = 'md' }) => {
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'building':
      case 'generating':
      case 'processing':
      case 'monitoring_status':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'in_queue':
      case 'previewing':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };

  const displayText = status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium rounded-full',
        getStatusColor(status),
        sizes[size]
      )}
    >
      {displayText}
    </span>
  );
};

export default Badge;
