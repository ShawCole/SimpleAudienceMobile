import React, { useMemo, useState, useRef, useEffect } from 'react';
import { FixedSizeList as List } from 'react-window';
import { Search, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from './input';
import { Card } from './card';
import { IndexedOptionValue } from '../../../../shared/types';
import clsx from 'clsx';

interface SearchableMultiSelectProps {
  label?: string;
  helperText?: string;
  options: IndexedOptionValue[];
  value?: IndexedOptionValue[];
  onChange: (next: IndexedOptionValue[]) => void;
  className?: string;
  placeholder?: string;
}

const toggleValue = (current: IndexedOptionValue[] = [], option: IndexedOptionValue) => {
  const exists = current.find(v => v.index === option.index);
  if (exists) {
    return current.filter(v => v.index !== option.index);
  }
  return [...current, option];
};

export const SearchableMultiSelect: React.FC<SearchableMultiSelectProps> = ({
  label,
  helperText,
  options,
  value = [],
  onChange,
  className,
  placeholder,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    // Hide already selected options
    const available = options.filter(option => !value.some(v => v.index === option.index));

    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return available;
    }
    return available.filter(option => option.label.toLowerCase().includes(normalized));
  }, [options, value, query]);

  const handleToggle = (option: IndexedOptionValue) => {
    const isSelected = value.some(v => v.index === option.index);
    if (isSelected) {
      onChange(value.filter(v => v.index !== option.index));
    } else {
      onChange([...value, option]);
    }
  };

  const handleRemove = (e: React.MouseEvent, option: IndexedOptionValue) => {
    e.stopPropagation();
    onChange(value.filter(v => v.index !== option.index));
  };

  const itemSize = 40;
  const listHeight = Math.min(filteredOptions.length * itemSize, 240);

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const option = filteredOptions[index];

    return (
      <div
        style={style}
        className="px-4 py-2 cursor-pointer text-sm flex items-center justify-between transition-colors text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50"
        onClick={() => handleToggle(option)}
      >
        <span className="truncate">{option.label}</span>
      </div>
    );
  };

  return (
    <div className={clsx("relative space-y-2", className)} ref={containerRef}>
      <div className="flex items-center justify-between px-1">
        <div>
          {label && (
            <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
          )}
          {helperText && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{helperText}</p>
          )}
        </div>
        <span className="text-xs text-gray-500">{value.length} selected</span>
      </div>

      <div
        className={clsx(
          "relative min-h-[2.5rem] border bg-white dark:bg-gray-800 px-3 py-1.5 flex flex-wrap items-center gap-2 cursor-pointer transition-all pr-[39px]",
          isOpen
            ? "border-blue-500 ring-2 ring-blue-500/10 rounded-t-lg border-b-transparent z-10"
            : "border-gray-300 dark:border-gray-600 hover:border-gray-400 rounded-lg"
        )}
        onClick={() => setIsOpen(true)}
      >
        {value.map(option => (
          <span
            key={option.index}
            className="inline-flex h-7 items-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 pl-2.5 pr-1 text-xs font-medium"
          >
            <span className="truncate max-w-[120px]">{option.label}</span>
            <button
              type="button"
              onClick={(e) => handleRemove(e, option)}
              className="ml-1 flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 hover:bg-red-50 hover:text-red-500 hover:border-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-all"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <div className="flex-1 flex items-center min-w-[120px]">
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            placeholder={value.length === 0 ? placeholder || "Select options..." : ""}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
          />
        </div>

        {(value.length > 0 || query !== '') && (
          <div className="absolute right-0 top-0 bottom-0 w-[38px] flex items-center justify-center z-10">
            <div className="absolute left-0 top-1.5 bottom-1.5 border-l border-gray-200 dark:border-gray-700" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
                setQuery('');
              }}
              className="group flex h-6 w-6 items-center justify-center rounded transition-all text-gray-400 hover:text-red-500 hover:bg-red-50 hover:border hover:border-red-500"
              title="Clear all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-[100] w-full bg-white dark:bg-gray-800 rounded-b-lg border border-blue-500 border-t-0 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200 !mt-0 -mt-[1px]">
          {filteredOptions.length > 0 ? (
            <List
              height={listHeight}
              itemCount={filteredOptions.length}
              itemSize={itemSize}
              width="100%"
              className="scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700"
            >
              {Row}
            </List>
          ) : (
            <div className="p-4 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">No matches found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchableMultiSelect;
