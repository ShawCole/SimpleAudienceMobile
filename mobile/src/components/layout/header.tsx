/**
 * Header Component
 * Mobile-first navigation header
 */

import React from 'react';
import Link from 'next/link';
import { Menu, Plus } from 'lucide-react';

interface HeaderProps {
  title?: string;
  onMenuClick?: () => void;
  showCreateButton?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title = 'SimpleAudience',
  onMenuClick,
  showCreateButton = true,
}) => {
  return (
    <header className="sticky top-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center space-x-3">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Menu"
            >
              <Menu size={24} />
            </button>
          )}
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {title}
          </h1>
        </div>

        {showCreateButton && (
          <Link
            href="/create"
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus size={20} />
            <span className="hidden sm:inline">Create</span>
          </Link>
        )}
      </div>
    </header>
  );
};

export default Header;
