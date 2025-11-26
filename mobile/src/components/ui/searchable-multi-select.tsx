import React, { useMemo, useState } from 'react';
import { Input } from './input';
import { Card } from './card';
import { IndexedOptionValue } from '../../../../shared/types';

interface Option {
  value: number;
  label: string;
}

interface SearchableMultiSelectProps {
  label?: string;
  helperText?: string;
  options: Option[];
  value?: IndexedOptionValue[];
  onChange: (next: IndexedOptionValue[]) => void;
  className?: string;
}

const toggleValue = (current: IndexedOptionValue[] = [], option: Option) => {
  if (current.some(item => item.index === option.value)) {
    return current.filter(item => item.index !== option.value);
  }
  return [...current, { index: option.value, label: option.label }];
};

export const SearchableMultiSelect: React.FC<SearchableMultiSelectProps> = ({
  label,
  helperText,
  options,
  value = [],
  onChange,
  className,
}) => {
  const [query, setQuery] = useState('');

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return options;
    }
    return options.filter(option => option.label.toLowerCase().includes(normalized));
  }, [options, query]);

  return (
    <Card padding="md" className={className}>
      <div className="flex items-center justify-between mb-3">
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

      <Input
        placeholder="Search options"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="mt-3 max-h-48 overflow-y-auto pr-1 space-y-2">
        {filteredOptions.map(option => (
          <label
            key={option.value}
            className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
          >
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={value.some(selected => selected.index === option.value)}
              onChange={() => onChange(toggleValue(value, option))}
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
        {filteredOptions.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">No matches</p>
        )}
      </div>
    </Card>
  );
};

export default SearchableMultiSelect;
