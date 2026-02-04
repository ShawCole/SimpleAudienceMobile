import React from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  fullWidth?: boolean;
  onClear?: () => void;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  fullWidth = true,
  onClear,
  className,
  ...props
}) => {
  const hasValue = props.value && String(props.value).length > 0;

  return (
    <div className={clsx(fullWidth && 'w-full')}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
        </label>
      )}
      <div className="relative group/tooltip">
        <input
          className={clsx(
            'block px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm transition-all',
            'bg-white text-gray-900 placeholder-gray-500 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400',
            props.disabled
              ? 'bg-gray-100 dark:bg-gray-900/50 text-gray-400 dark:text-gray-500 cursor-not-allowed border-gray-200 dark:border-gray-700'
              : error
                ? 'border-red-300 text-red-900 placeholder-red-300 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300 dark:border-gray-600 hover:border-gray-400',
            fullWidth && 'w-full',
            onClear && hasValue && 'pr-12',
            className
          )}
          {...props}
          title={undefined} // Disable native tooltip
        />

        {props.title && props.disabled && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-[10px] font-bold rounded shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[100]">
            {props.title}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
          </div>
        )}

        {onClear && hasValue && (
          <div className="absolute right-0 top-0 bottom-0 w-[38px] flex items-center justify-center z-10">
            <div className="absolute left-0 top-1.5 bottom-1.5 border-l border-gray-200 dark:border-gray-700" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="flex h-6 w-6 items-center justify-center rounded transition-all text-gray-400 hover:text-red-500 hover:bg-red-50 hover:border hover:border-red-500"
              title="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-red-600 px-1">{error}</p>}
    </div>
  );
};

export default Input;
