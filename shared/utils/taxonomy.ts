import { FILTER_TAXONOMY } from '../taxonomy/filter-taxonomy';

export interface FilterOption {
  index: number;
  label: string;
}

export function getFilterOptions(category: string, filterName: string): FilterOption[] {
  const section = (FILTER_TAXONOMY as Record<string, any>)[category];
  if (!section) {
    return [];
  }
  const filter = section[filterName];
  if (!filter || !Array.isArray(filter.options)) {
    return [];
  }
  return filter.options.map((option: any, idx: number) => ({
    index: typeof option.index === 'number' ? option.index : idx,
    label: option.label,
  }));
}

export function mapIndicesToLabels(
  category: string,
  filterName: string,
  indices?: number[] | null
): string[] {
  if (!indices || indices.length === 0) {
    return [];
  }

  const options = getFilterOptions(category, filterName);
  const byIndex = new Map(options.map(option => [option.index, option.label]));
  const labels = indices
    .map(index => byIndex.get(index))
    .filter((label): label is string => Boolean(label));

  if (labels.length !== indices.length && process.env.NODE_ENV !== 'production') {
    const missing = indices.filter(index => !byIndex.has(index));
    if (missing.length) {
      // eslint-disable-next-line no-console
      console.warn('[taxonomy] Unresolved indices', {
        category,
        filterName,
        missing,
      });
    }
  }

  return labels;
}
