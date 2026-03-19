
'use client';

import React, { useMemo, useState, useEffect, useRef, useId, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  Target,
  Sparkles,
  Briefcase,
  DollarSign,
  UserCircle,
  Users,
  Home,
  Phone,
  ClipboardCheck,
  ChevronDown,
  Sun,
  Moon,
  X
} from 'lucide-react';
import clsx from 'clsx';
import { Header } from '../../components/layout/header';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Card } from '../../components/ui/card';
import SearchableMultiSelect from '../../components/ui/searchable-multi-select';
import { apiClient } from '../../services/api-client';
import {
  AudiencePayload,
  IndexedOptionValue,
  ToggleChoice,
  AudienceFilters,
  NumericRange,
} from '../../../../shared/types';
import { FilterSection } from '../../../../shared/taxonomy/filter-taxonomy';
import { getFilterOptions, mapIndicesToLabels } from '../../../../shared/utils';
import {
  BUSINESS_FIELD_MAP,
  FINANCIAL_FIELD_MAP,
  PERSONAL_FIELD_MAP,
  FAMILY_FIELD_MAP,
  HOUSING_FIELD_MAP,
  CONTACT_FIELD_MAP,
  CONTACT_FIELD_LABELS,
} from '../../../../shared/config/filter-groups';

// A custom hook to detect clicks outside of a component
function useClickOutside(ref: React.RefObject<HTMLElement>, handler: () => void) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      // Do nothing if clicking ref's element or descendent elements
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler();
    };

    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}

const defaultPayload: AudiencePayload = {
  name: '',
  clientName: '',
  listPrice: '',
  location: {
    cities: [],
    states: [],
    zipCodes: [],
  },
  intent: {
    mode: 'none',
    audienceType: 'b2b',
    keywords: [],
  },
  filters: {},
};

type StepId =
  | 'name'
  | 'location'
  | 'business'
  | 'financial'
  | 'personal'
  | 'family'
  | 'housing'
  | 'contact'
  | 'intent'
  | 'review';

const steps: { id: StepId; label: string; description: string; icon: React.ComponentType<any> }[] = [
  { id: 'name', label: 'Name Audience', description: 'Give this audience a clear title', icon: ClipboardCheck },
  { id: 'location', label: 'Location Filters', description: 'Cities, states, and ZIP targeting', icon: MapPin },
  { id: 'business', label: 'Business Filters', description: 'Seniority, departments, industries', icon: Briefcase },
  { id: 'financial', label: 'Financial Filters', description: 'Income, net worth, credit', icon: DollarSign },
  { id: 'personal', label: 'Personal Filters', description: 'Demographics and lifestyle', icon: UserCircle },
  { id: 'family', label: 'Family Filters', description: 'Household composition', icon: Users },
  { id: 'housing', label: 'Housing Filters', description: 'Property and home value', icon: Home },
  { id: 'contact', label: 'Contact Filters', description: 'Email and phone quality', icon: Phone },
  { id: 'intent', label: 'Intent Targeting', description: 'Keywords, AI, and premade intents', icon: Target },
  { id: 'review', label: 'Review & Create', description: 'Preview and generate audience', icon: ClipboardCheck },
];

const PREMADE_TOPICS: Record<'b2b' | 'b2c', IndexedOptionValue[]> = {
  b2b: [
    { index: 0, label: 'HR Software Decision Makers' },
    { index: 1, label: 'IT Security Leaders' },
    { index: 2, label: 'Marketing Automation Buyers' },
    { index: 3, label: 'Sales Operations Leaders' },
    { index: 4, label: 'Procurement Directors' },
  ],
  b2c: [
    { index: 0, label: 'First-Time Home Buyers' },
    { index: 1, label: 'Parents With Young Children' },
    { index: 2, label: 'Fitness Enthusiasts' },
    { index: 3, label: 'Luxury Travelers' },
    { index: 4, label: 'Eco-Friendly Shoppers' },
  ],
};

const REVIEW_GROUP_STEP_MAP: Record<string, StepId> = {
  business: 'business',
  financial: 'financial',
  personal: 'personal',
  family: 'family',
  housing: 'housing',
  contact: 'contact',
};

const SHOW_ADVANCED_INTENT_OPTIONS = false;

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

type SectionKey = FilterSection;

interface Chip {
  key: string;
  filterLabel: string;
  valueLabel: string;
}

interface ChipGroup {
  id: string;
  label: string;
  chips: Chip[];
}

const joinWithAnd = (items: string[]): string => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const joinWithOrQuoted = (items: string[]): string => {
  if (items.length === 0) return '';
  const quoted = items.map(item => `"${item}"`);
  if (quoted.length === 1) return quoted[0];
  if (quoted.length === 2) return `${quoted[0]} or ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(', ')}, or ${quoted[quoted.length - 1]}`;
};

const buildNarrativeDescription = (draft: AudiencePayload): string => {
  const seniorityLabels =
    draft.filters.business?.seniority?.map(option => option.label).filter(Boolean) ?? [];
  const marriedLabels = draft.filters.family?.married?.map(option => option.label) ?? [];
  const homeownerLabels = draft.filters.housing?.homeownerStatus?.map(option => option.label) ?? [];

  const hasSeniority = seniorityLabels.length > 0;
  const isMarried = marriedLabels.some(label => /married|yes/i.test(label));
  const isHomeowner = homeownerLabels.some(label => /homeowner/i.test(label));

  const baseSeniority = hasSeniority ? joinWithAnd(seniorityLabels) : '';

  let subject: string;
  if (isMarried && isHomeowner) {
    if (hasSeniority) {
      subject = `Married Homeowner ${baseSeniority}`;
    } else {
      subject = 'Married Homeowners';
    }
  } else if (isMarried) {
    subject = hasSeniority ? `Married ${baseSeniority}` : 'Married people';
  } else if (isHomeowner) {
    subject = hasSeniority ? `Homeowner ${baseSeniority}` : 'Homeowners';
  } else if (hasSeniority) {
    subject = baseSeniority;
  } else {
    subject = 'People';
  }

  // Age
  const ageRange = draft.filters.personal?.ageRange;
  let agePhrase: string | null = null;
  if (ageRange) {
    const { min, max } = ageRange;
    if (min != null && max != null) {
      agePhrase = `ages ${min}–${max}`;
    } else if (min != null) {
      agePhrase = `ages ${min}+`;
    } else if (max != null) {
      agePhrase = `ages up to ${max}`;
    }
  }

  // Location
  const { cities, states, zipCodes } = draft.location;
  const hasCities = cities.length > 0;
  const hasStates = states.length > 0;
  const hasZips = zipCodes.length > 0;

  let locationPhrase: string | null = null;
  if (hasCities || hasStates || hasZips) {
    const citiesText = hasCities ? joinWithAnd(cities) : '';
    const statesText = hasStates ? joinWithAnd(states) : '';
    const zipsText = hasZips ? joinWithAnd(zipCodes) : '';

    if (hasCities && hasStates) {
      locationPhrase = `live in ${citiesText}, and across ${statesText}`;
    } else if (hasCities) {
      locationPhrase = `live in ${citiesText}`;
    } else if (hasStates) {
      locationPhrase = `live across ${statesText}`;
    }

    if (hasZips) {
      const zipPart = `ZIP codes ${zipsText}`;
      if (locationPhrase) {
        locationPhrase = `${locationPhrase}, and in ${zipPart}`;
      } else {
        locationPhrase = `live in ${zipPart}`;
      }
    }
  }

  // Financial: income
  const incomeOptions = draft.filters.financial?.incomeRange ?? [];
  let incomePhrase: string | null = null;
  if (incomeOptions.length === 1) {
    const label = incomeOptions[0].label;
    if (/\+/.test(label)) {
      const cleaned = label.replace('+', '').trim();
      incomePhrase = `make ${cleaned} or more per year`;
    } else if (/[-–]/.test(label)) {
      const [minLabel, maxLabel] = label.split(/[-–]/);
      if (minLabel && maxLabel) {
        incomePhrase = `make between ${minLabel.trim()} and ${maxLabel.trim()} per year`;
      }
    } else {
      incomePhrase = `have income ${label}`;
    }
  } else if (incomeOptions.length > 1) {
    const labels = incomeOptions.map(option => option.label);
    incomePhrase = `have income ranges ${joinWithAnd(labels)}`;
  }

  // Financial: net worth
  const netWorthOptions = draft.filters.financial?.netWorth ?? [];
  let netWorthPhrase: string | null = null;
  if (netWorthOptions.length === 1) {
    const label = netWorthOptions[0].label;
    if (/\+/.test(label)) {
      const cleaned = label.replace('+', '').trim();
      netWorthPhrase = `are worth ${cleaned} or more`;
    } else if (/[-–]/.test(label)) {
      const [minLabel, maxLabel] = label.split(/[-–]/);
      if (minLabel && maxLabel) {
        netWorthPhrase = `are worth between ${minLabel.trim()} and ${maxLabel.trim()}`;
      }
    } else {
      netWorthPhrase = `have a net worth of ${label}`;
    }
  } else if (netWorthOptions.length > 1) {
    const labels = netWorthOptions.map(option => option.label);
    netWorthPhrase = `have net worth ranges ${joinWithAnd(labels)}`;
  }

  // Education
  const rawEducationLabels =
    draft.filters.personal?.education?.map(option => option.label).filter(Boolean) ?? [];

  const educationLabels = rawEducationLabels.map(label => {
    if (/high school/i.test(label)) {
      return 'High School Diploma';
    }
    if (/bachelor/i.test(label)) {
      return "Bachelor's Degree";
    }
    if (/master/i.test(label)) {
      return "Master's Degree";
    }
    if (/doctorate/i.test(label)) {
      return 'Doctorate';
    }
    return label;
  });
  let educationPhrase: string | null = null;
  if (educationLabels.length === 1) {
    const only = educationLabels[0];
    if (only === 'Doctorate') {
      educationPhrase = 'with a Doctorate';
    } else {
      educationPhrase = `with a ${only}`;
    }
  } else if (educationLabels.length > 1) {
    educationPhrase = `with either a ${joinWithAnd(educationLabels)}`;
  }

  // Housing: purchase year
  const purchaseYear = draft.filters.housing?.purchaseYear;
  let purchasePhrase: string | null = null;
  if (purchaseYear) {
    const { min, max } = purchaseYear;
    if (min != null && max != null) {
      purchasePhrase = `who purchased their homes between ${min} and ${max}`;
    } else if (min != null) {
      purchasePhrase = `who purchased their homes after ${min}`;
    } else if (max != null) {
      purchasePhrase = `who purchased their homes before ${max}`;
    }
  }

  // Job Titles
  const jobTitles = draft.filters.business?.jobTitles?.map(o => o.label).filter(Boolean) || [];
  let jobTitlePhrase: string | null = null;
  if (jobTitles.length > 0) {
    jobTitlePhrase = `with job titles like ${joinWithAnd(jobTitles)}`;
  }

  // Company Names
  const companyNames = draft.filters.business?.companyName?.map(o => o.label).filter(Boolean) || [];
  let companyPhrase: string | null = null;
  if (companyNames.length > 0) {
    const joined = joinWithOrQuoted(companyNames);
    companyPhrase = `in Companies with ${joined} in the name`;
  }

  // Company Domains
  const companyDomains = draft.filters.business?.companyDomain?.map(o => o.label).filter(Boolean) || [];
  let domainPhrase: string | null = null;
  if (companyDomains.length > 0) {
    const joined = joinWithOrQuoted(companyDomains);
    domainPhrase = `in Companies with a domain of ${joined}`;
  }

  // SIC Codes
  const sicCodes = draft.filters.business?.sic?.map(o => o.label).filter(Boolean) || [];
  let sicPhrase: string | null = null;
  if (sicCodes.length > 0) {
    const joined = joinWithOrQuoted(sicCodes);
    sicPhrase = `in Companies with a SIC code of ${joined}`;
  }

  // NAICS Codes
  const naicsCodes = draft.filters.business?.companyNaics?.map(o => o.label).filter(Boolean) || [];
  let naicsPhrase: string | null = null;
  if (naicsCodes.length > 0) {
    const joined = joinWithOrQuoted(naicsCodes);
    naicsPhrase = `in Companies with a NAICS code of ${joined}`;
  }

  // B2B Business Keywords (Company Description)
  const businessKeywords = draft.filters.business?.companyDescription?.map(o => o.label).filter(Boolean) || [];
  let businessKeywordsPhrase: string | null = null;
  if (businessKeywords.length > 0) {
    const joined = joinWithOrQuoted(businessKeywords);
    businessKeywordsPhrase = `at companies with ${joined} in their description`;
  }

  // Industries
  const industries = draft.filters.business?.industries?.map(o => o.label).filter(Boolean) || [];
  let industryPhrase: string | null = null;
  if (industries.length > 0) {
    industryPhrase = `in the ${joinWithAnd(industries)} industries`;
  }

  // Intent (for the narrative – separate from structured line)
  const keywordTopics = draft.intent.keywords || [];
  const premadeTopics = draft.intent.premadeTopics?.map(topic => topic.label) ?? [];
  const allTopics = Array.from(new Set([...keywordTopics, ...premadeTopics])).filter(Boolean);
  const hasIntentTopics = draft.intent.mode !== 'none' && allTopics.length > 0;
  const intentPhrase = hasIntentTopics ? `searching for ${joinWithAnd(allTopics)}` : null;

  // Build the sentence
  let sentence = subject;
  if (agePhrase) {
    sentence += `, ${agePhrase}`;
  }

  const descriptiveClauses: string[] = [];
  if (incomePhrase) descriptiveClauses.push(incomePhrase);
  if (netWorthPhrase) descriptiveClauses.push(netWorthPhrase);
  if (educationPhrase) descriptiveClauses.push(educationPhrase);
  if (purchasePhrase) descriptiveClauses.push(purchasePhrase);
  if (jobTitlePhrase) descriptiveClauses.push(jobTitlePhrase);
  if (companyPhrase) descriptiveClauses.push(companyPhrase);
  if (domainPhrase) descriptiveClauses.push(domainPhrase);
  if (sicPhrase) descriptiveClauses.push(sicPhrase);
  if (naicsPhrase) descriptiveClauses.push(naicsPhrase);
  if (businessKeywordsPhrase) descriptiveClauses.push(businessKeywordsPhrase);
  if (industryPhrase) descriptiveClauses.push(industryPhrase);

  const hasLocation = Boolean(locationPhrase);

  if (locationPhrase) {
    sentence += ` who ${locationPhrase}`;
  }

  if (descriptiveClauses.length > 0) {
    if (hasLocation) {
      sentence += ', ';
    } else {
      const firstClause = descriptiveClauses[0];
      if (/^(in|with)\s/i.test(firstClause)) {
        sentence += ' ';
      } else {
        sentence += ' who ';
      }
    }
    sentence += joinWithAnd(descriptiveClauses);
  }

  if (intentPhrase) {
    sentence += `, ${intentPhrase}`;
  }

  // Fallback when truly nothing descriptive is set
  if (!hasLocation && descriptiveClauses.length === 0 && !intentPhrase) {
    if (hasCities || hasStates || hasZips) {
      // Should be covered by locationPhrase, but keep as extra guard
      sentence = 'People who live in this audience\'s selected locations';
    } else {
      sentence = 'People in this audience';
    }
  }

  return `${sentence}.`;
};

const buildFiltersSummary = (draft: AudiencePayload, reviewGroups: ChipGroup[]): string => {
  const lines: string[] = [];

  const clientName = draft.clientName?.trim() || '[Client not set]';
  const audienceName = draft.name?.trim() || '[Untitled Audience]';

  // Header
  lines.push(`For Client ${clientName}`);
  lines.push(audienceName);

  // Narrative description
  const narrative = buildNarrativeDescription(draft);
  if (narrative) {
    lines.push('');
    lines.push('Audience Description:');
    lines.push(narrative);
  }

  // Intent line (optional, structured)
  const keywordTopics = draft.intent.keywords || [];
  const premadeTopics = draft.intent.premadeTopics?.map(topic => topic.label) ?? [];
  const allTopics = Array.from(new Set([...keywordTopics, ...premadeTopics])).filter(Boolean);

  if (draft.intent.mode !== 'none' && allTopics.length > 0) {
    lines.push('');
    lines.push(`People searching for: ${allTopics.join(', ')}`);
  }

  const hasLocationFilters =
    draft.location.cities.length > 0 ||
    draft.location.states.length > 0 ||
    draft.location.zipCodes.length > 0;

  const hasSectionFilters = reviewGroups.some(group => group.chips.length > 0);

  // Filters block
  if (hasLocationFilters || hasSectionFilters) {
    lines.push('');

    if (hasLocationFilters) {
      lines.push('Location:');
      if (draft.location.cities.length > 0) {
        lines.push(`- Cities: ${draft.location.cities.join(', ')}`);
      }
      if (draft.location.states.length > 0) {
        lines.push(`- States: ${draft.location.states.join(', ')}`);
      }
      if (draft.location.zipCodes.length > 0) {
        lines.push(`- ZIP Codes: ${draft.location.zipCodes.join(', ')}`);
      }
      lines.push('');
    }

    reviewGroups.forEach(group => {
      if (!group.chips.length) return;

      lines.push(`${group.label}:`);

      // Group chips by filterLabel to handle special collection types
      const chipsByLabel = new Map<string, string[]>();
      group.chips.forEach(chip => {
        if (!chipsByLabel.has(chip.filterLabel)) {
          chipsByLabel.set(chip.filterLabel, []);
        }
        chipsByLabel.get(chip.filterLabel)!.push(chip.valueLabel);
      });

      chipsByLabel.forEach((values, label) => {
        if (label === 'Company Names') {
          lines.push(`- Company Name includes: ${joinWithOrQuoted(values)}`);
        } else if (label === 'Company Domains') {
          lines.push(`- Company Domain includes: ${joinWithOrQuoted(values)}`);
        } else if (label === 'Job Titles') {
          lines.push(`- Job Title includes: ${joinWithOrQuoted(values)}`);
        } else if (label === 'SIC Codes') {
          lines.push(`- SIC Code includes: ${joinWithOrQuoted(values)}`);
        } else if (label === 'NAICS Codes') {
          lines.push(`- NAICS Code includes: ${joinWithOrQuoted(values)}`);
        } else if (label === 'B2B Business Keywords') {
          lines.push(`- Company Description includes: ${joinWithOrQuoted(values)}`);
        } else {
          // Default behavior for other filters
          values.forEach(val => {
            lines.push(`- ${label}: ${val}`);
          });
        }
      });
      lines.push('');
    });
  } else {
    lines.push('');
    lines.push('No filters selected');
  }

  // Trim trailing blank lines, then ensure a final newline at the end
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  lines.push('');

  return lines.join('\n');
};

const getOptions = (section: SectionKey, filter: string): IndexedOptionValue[] =>
  getFilterOptions(section, filter).map(option => ({
    index: option.index,
    label: option.label,
  }));

const getSearchOptions = (section: SectionKey, filter: string) =>
  getFilterOptions(section, filter).map(option => ({
    value: option.index,
    label: option.label,
  }));

const resolveLabels = (
  section: SectionKey,
  filter: string,
  items?: IndexedOptionValue[]
): string[] => items?.map(item => item.label) || [];

const formatNumericRange = (
  range?: NumericRange,
  formatter: (value: number) => string = value => value.toString()
): string | null => {
  if (!range) {
    return null;
  }
  const { min, max } = range;
  if (min != null && max != null) {
    return `${formatter(min)} – ${formatter(max)}`;
  }
  if (min != null) {
    return `≥ ${formatter(min)}`;
  }
  if (max != null) {
    return `≤ ${formatter(max)}`;
  }
  return null;
};

const formatCurrencyRange = (range?: NumericRange) =>
  formatNumericRange(range, value => currencyFormatter.format(value));

const createChipsFromOptions = (
  section: SectionKey,
  filterLabel: string,
  items?: IndexedOptionValue[]
): Chip[] => {
  const labels = resolveLabels(section, filterLabel, items);
  return labels.map((valueLabel, index) => ({
    key: `${section}-${filterLabel}-${items?.[index]?.index ?? index}`,
    filterLabel,
    valueLabel,
  }));
};

const addRangeChip = (chips: Chip[], label: string, formatted: string | null, keyPrefix: string) => {
  if (!formatted) {
    return;
  }
  chips.push({
    key: `${keyPrefix}-${label}-${formatted}`,
    filterLabel: label,
    valueLabel: formatted,
  });
};

const toggleSelection = (current: IndexedOptionValue[] = [], option: IndexedOptionValue) => {
  const exists = current.some(item => item.index === option.index);
  if (exists) {
    return current.filter(item => item.index !== option.index);
  }
  return [...current, option];
};

const hasAnyFilters = (payload: AudiencePayload): boolean => {
  const hasLocation =
    payload.location.cities.length > 0 ||
    payload.location.states.length > 0 ||
    payload.location.zipCodes.length > 0;

  const hasIntent =
    payload.intent.mode !== 'none' &&
    (payload.intent.keywords.length > 0 || (payload.intent.premadeTopics?.length ?? 0) > 0);

  const hasAdvanced = Object.values(payload.filters).some(section => {
    if (!section) return false;
    return Object.values(section).some(value => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).some(inner => inner !== undefined && inner !== '');
      }
      return value !== undefined && value !== null && value !== 'any';
    });
  });

  return hasLocation || hasIntent || hasAdvanced;
};

interface MultiSelectFieldProps {
  label: string;
  options: IndexedOptionValue[];
  value?: IndexedOptionValue[];
  onChange: (value: IndexedOptionValue[]) => void;
}

interface ChipMultiSelectProps {
  label: string;
  options: IndexedOptionValue[];
  value?: IndexedOptionValue[];
  onChange: (value: IndexedOptionValue[]) => void;
  placeholder?: string;
}

const MultiSelectField: React.FC<MultiSelectFieldProps> = ({ label, options, value = [], onChange }) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const componentRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside
  useClickOutside(componentRef, () => setIsOpen(false));

  const filtered = useMemo(() => {
    const lower = query.toLowerCase();
    return options.filter(option => option.label.toLowerCase().includes(lower));
  }, [options, query]);

  const handleToggle = (option: IndexedOptionValue) => {
    onChange(toggleSelection(value, option));
  };

  const itemSize = 32; // height of each row in pixels; adjust if styling changes

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const option = filtered[index];
    if (!option) return null;

    const checked = value.some(item => item.index === option.index);

    return (
      <div style={style}>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 px-0.5">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={checked}
            onChange={() => handleToggle(option)}
          />
          <span className="truncate">{option.label}</span>
        </label>
      </div>
    );
  };

  // Compute dynamic height so non-scrollable lists don't leave extra whitespace
  const visibleItemCount = Math.min(filtered.length, 6); // 6 * 32 = 192px max
  const listHeight = visibleItemCount * itemSize;
  const dropdownWidth = componentRef.current?.offsetWidth;

  return (
    <div ref={componentRef} className="relative">
      <Card padding="md" className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
          <span className="text-xs text-gray-500">{value.length} selected</span>
        </div>

        {options.length > 8 && (
          <Input
            placeholder="Search options"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsOpen(true)}
            onClear={() => setQuery('')}
          />
        )}

        {options.length <= 8 && (
          <button
            type="button"
            className="w-full px-3 py-2 border rounded-lg shadow-sm text-left text-sm text-gray-500 border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            onClick={() => setIsOpen(!isOpen)}
          >
            {value.length === 0 ? 'Select...' : `${value.length} selected`}
          </button>
        )}

      </Card>
      {isOpen && (
        <div
          className="absolute left-0 z-30 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
          style={{ width: dropdownWidth }}
        >
          {filtered.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              <List height={listHeight} itemCount={filtered.length} itemSize={itemSize} width="100%">
                {Row}
              </List>
            </div>
          ) : (
            <p className="p-3 text-xs text-gray-500">No options match your search</p>
          )}
        </div>
      )}
    </div>
  );
};

const ChipMultiSelect: React.FC<ChipMultiSelectProps> = ({
  label,
  options,
  value = [],
  onChange,
  placeholder = 'Select...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setIsOpen(false));

  const availableOptions = useMemo(
    () => options.filter(option => !value.some(selected => selected.index === option.index)),
    [options, value]
  );
  const dropdownWidth = containerRef.current?.offsetWidth;

  const handleSelect = (option: IndexedOptionValue) => {
    onChange([...value, option]);
    setIsOpen(true);
  };

  const handleRemove = (option: IndexedOptionValue) => {
    onChange(value.filter(item => item.index !== option.index));
    setIsOpen(true);
  };

  return (
    <div ref={containerRef} className="relative space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
        <span className="text-xs text-gray-500">{value.length} selected</span>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(prev => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(prev => !prev);
          }
        }}
        className={clsx(
          "relative w-full min-h-[2.5rem] border bg-white dark:bg-gray-800 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 flex flex-wrap items-center gap-2 cursor-pointer transition-all pr-[39px]",
          isOpen
            ? "border-blue-500 ring-2 ring-blue-500/10 rounded-t-lg border-b-transparent z-10"
            : "border-gray-300 dark:border-gray-600 hover:border-gray-400 rounded-lg"
        )}
      >
        {value.length === 0 && (
          <span className="text-gray-400 dark:text-gray-500">{placeholder}</span>
        )}
        {value.map(option => (
          <span
            key={option.index}
            className="inline-flex h-7 items-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 pl-2.5 pr-1 text-sm font-medium transition-all"
          >
            <span className="mr-1 truncate max-w-[160px]">{option.label}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(option);
              }}
              className="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 hover:bg-red-50 hover:text-red-500 hover:border-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-all"
              aria-label={`Remove ${option.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length > 0 && (
          <div className="absolute right-0 top-0 bottom-0 w-[38px] flex items-center justify-center z-10">
            <div className="absolute left-0 top-1.5 bottom-1.5 border-l border-gray-200 dark:border-gray-700" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              className="group flex h-6 w-6 items-center justify-center rounded transition-all text-gray-400 hover:text-red-500 hover:bg-red-50 hover:border hover:border-red-500"
              title="Clear all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {isOpen && availableOptions.length > 0 && (
        <div
          className="absolute left-0 z-20 rounded-b-lg border border-blue-500 border-t-0 bg-white dark:bg-gray-900 shadow-lg max-h-60 overflow-y-auto !mt-0 -mt-[1px]"
          style={{ width: dropdownWidth }}
        >
          {availableOptions.map(option => (
            <button
              key={option.index}
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => handleSelect(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {isOpen && availableOptions.length === 0 && (
        <div
          className="absolute left-0 z-20 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg px-3 py-2 text-xs text-gray-500"
          style={{ width: dropdownWidth }}
        >
          All options selected
        </div>
      )}
    </div>
  );
};

const KeywordChipInput: React.FC<{
  label: string;
  placeholder?: string;
  value: IndexedOptionValue[];
  onChange: (value: IndexedOptionValue[]) => void;
  maxItems?: number;
  validate?: (val: string) => boolean;
  errorText?: string;
  beta?: boolean;
}> = ({ label, placeholder = 'Type and press Enter...', value = [], onChange, maxItems, validate, errorText, beta }) => {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      e.stopPropagation();

      const trimmed = inputValue.trim();
      if (!trimmed) return;

      if (maxItems && value.length >= maxItems) {
        setError(`Maximum of ${maxItems} items allowed`);
        return;
      }

      if (validate && !validate(trimmed)) {
        setError(errorText || 'Invalid format');
        return;
      }

      if (!value.some(v => v.label.toLowerCase() === trimmed.toLowerCase())) {
        onChange([...value, { index: Date.now(), label: trimmed }]);
      }
      setInputValue('');
      setError(null);
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      onChange(value.slice(0, -1));
      setError(null);
    }
  };

  const handleRemove = (option: IndexedOptionValue) => {
    onChange(value.filter(v => v.index !== option.index));
    setError(null);
  };

  return (
    <div className="relative space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
          {beta && (
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wider">
              BETA
            </span>
          )}
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-gray-500">
            {value.length}{maxItems ? ` / ${maxItems}` : ''} selected
          </span>
        </div>
      </div>

      <div className={clsx(
        "relative w-full min-h-[2.5rem] rounded-lg border bg-white dark:bg-gray-800 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 flex flex-wrap items-center gap-2 transition-all pr-12",
        error ? "border-red-500" : "border-gray-300 dark:border-gray-600 hover:border-gray-400 focus-within:ring-2 focus-within:ring-blue-500/10 focus-within:border-blue-500"
      )}>
        {value.map(option => (
          <span
            key={option.index}
            className="inline-flex h-7 items-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 pl-2.5 pr-1 text-sm font-medium transition-all"
          >
            <span className="mr-1 truncate max-w-[160px]">{option.label}</span>
            <button
              type="button"
              onClick={() => handleRemove(option)}
              className="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 hover:bg-red-50 hover:text-red-500 hover:border-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-all"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          className="flex-1 min-w-[120px] bg-transparent border-none outline-none focus:ring-0 p-0 h-7 text-sm placeholder-gray-400 dark:placeholder-gray-500"
          placeholder={value.length === 0 ? placeholder : ''}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
        />

        {value.length > 0 && (
          <div className="absolute right-0 top-0 bottom-0 w-[38px] flex items-center justify-center z-10">
            <div className="absolute left-0 top-1.5 bottom-1.5 border-l border-gray-200 dark:border-gray-700" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
                setInputValue('');
              }}
              className="group flex h-6 w-6 items-center justify-center rounded transition-all text-gray-400 hover:text-red-500 hover:bg-red-50 hover:border hover:border-red-500"
              title="Clear all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-500 px-1">{error}</p>}
    </div>
  );
};

const PreviewTable: React.FC<{ preview: any[]; totalCount: number | null }> = ({ preview, totalCount }) => {
  const [page, setPage] = useState(1);
  const itemsPerPage = 50;
  const totalPages = Math.ceil(preview.length / itemsPerPage);
  const currentData = preview.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const formatList = (val: any) => {
    if (!val) return '-';
    if (Array.isArray(val)) return val.join(', ');
    if (typeof val === 'string' && val.includes(',')) return val; // Already formatted
    return String(val);
  };

  return (
    <div className="overflow-hidden border rounded-lg border-gray-200 dark:border-gray-700">
      <div className="overflow-x-auto max-h-[400px]">
        <table className="w-full caption-bottom text-xs">
          <thead className="bg-[#f8f9fc] dark:bg-gray-800 sticky top-0 z-[1] border-b">
            <tr className="border-b transition-colors">
              <th className="px-2 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-12">#</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-28">First Name</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-28 border-l border-gray-200 dark:border-gray-700">Last Name</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-48 border-l border-gray-200 dark:border-gray-700">Business Email</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-40 border-l border-gray-200 dark:border-gray-700">Business Phone</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-40 border-l border-gray-200 dark:border-gray-700">Company Domain</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-40 border-l border-gray-200 dark:border-gray-700">Job Title</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-40 border-l border-gray-200 dark:border-gray-700">Personal Phone</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-48 border-l border-gray-200 dark:border-gray-700">Personal Email</th>
              <th className="px-3 text-left align-middle font-semibold text-gray-600 dark:text-gray-300 h-10 whitespace-nowrap min-w-32 border-l border-gray-200 dark:border-gray-700">Hash</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {currentData.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <td className="p-2 align-middle text-gray-500 font-medium">{(page - 1) * itemsPerPage + i + 1}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-40 truncate">{row.first_name || '-'}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-40 truncate border-l border-gray-100 dark:border-gray-800">{row.last_name || '-'}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-60 truncate border-l border-gray-100 dark:border-gray-800">{formatList(row.b2b_email)}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-40 truncate border-l border-gray-100 dark:border-gray-800">{formatList(row.b2b_phone)}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-40 truncate border-l border-gray-100 dark:border-gray-800">{row.company_domain || '-'}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-40 truncate border-l border-gray-100 dark:border-gray-800">{row.job_title || '-'}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-40 truncate border-l border-gray-100 dark:border-gray-800">{formatList(row.personal_phone)}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-60 truncate border-l border-gray-100 dark:border-gray-800">{formatList(row.personal_email)}</td>
                <td className="p-2 align-middle text-gray-700 dark:text-gray-200 max-w-40 truncate border-l border-gray-100 dark:border-gray-800">{row.sha256 || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-[#fcfdfe] dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 py-2.5">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
          <span className="font-semibold text-gray-900 dark:text-white">
            {totalCount?.toLocaleString() || '-'}
          </span> results found
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-medium text-gray-500 uppercase tracking-tight mr-2">
            {page} / {totalPages || 1}
          </div>
          <Button
            variant="secondary"
            className="h-7 text-[11px] px-3 font-semibold"
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            className="h-7 text-[11px] px-3 font-semibold"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
};

interface ToggleFieldProps {
  label: string;
  value?: ToggleChoice;
  onChange: (value: ToggleChoice) => void;
}

const ToggleField: React.FC<ToggleFieldProps> = ({ label, value = 'any', onChange }) => {
  const isRequired = value === 'on';
  return (
    <Card padding="md" className="flex items-center justify-between">
      <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
      <Button
        variant={isRequired ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => onChange(isRequired ? 'any' : 'on')}
      >
        {isRequired ? 'Required' : 'Not Required'}
      </Button>
    </Card>
  );
};

const NavButtonRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex gap-3">
    {React.Children.map(children, child => {
      if (!React.isValidElement(child)) {
        return child;
      }
      const existingClassName = child.props.className ?? '';
      const mergedClassName = ['flex-1', existingClassName].filter(Boolean).join(' ');
      return React.cloneElement(child, { className: mergedClassName });
    })}
  </div>
);

export default function CreateAudiencePage() {
  const router = useRouter();
  const [draft, setDraft] = useState<AudiencePayload>(defaultPayload);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [filtersSummaryCollapsed, setFiltersSummaryCollapsed] = useState(false);
  const [locationForm, setLocationForm] = useState({ cities: '', states: '', zipCodes: '' });
  const [customKeywords, setCustomKeywords] = useState('');
  const [showKeywordError, setShowKeywordError] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [minAgeTouched, setMinAgeTouched] = useState(false);
  const [zipTouched, setZipTouched] = useState(false);
  const [previewState, setPreviewState] = useState<{
    loading: boolean;
    count: number | null;
    preview: any[];
    timestamp: string | null;
    status: 'idle' | 'pending' | 'ok' | 'error';
    debug?: any;
    error?: string;
  }>({
    loading: false,
    count: null,
    preview: [],
    timestamp: null,
    status: 'idle'
  });
  const [loading, setLoading] = useState(false);
  const keywordsInputId = useId();
  const keywordsErrorId = `${keywordsInputId}-error`;
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [prewarmStatus, setPrewarmStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const mortgageAmount = draft.filters.financial?.mortgageAmount;
  const mortgageInvalid =
    Boolean(
      mortgageAmount &&
      mortgageAmount.min != null &&
      mortgageAmount.max != null &&
      mortgageAmount.min > mortgageAmount.max
    );

  const currentStep = steps[currentStepIndex];
  const NAV_ICON_SIZE = 24;

  const canProceedFromNameStep =
    currentStep.id === 'name'
      ? Boolean(draft.name.trim() && draft.clientName?.trim())
      : true;

  const scrollToTop = () => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const goToStep = (id: StepId) => {
    const index = steps.findIndex(step => step.id === id);
    if (index >= 0) {
      setCurrentStepIndex(index);
      scrollToTop();
    }
  };

  const zipTokens = locationForm.zipCodes
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);
  const isZipFormatValid =
    zipTokens.length === 0 || zipTokens.every(token => /^\d{5}$/.test(token));

  const handleNext = async () => {
    if (currentStep.id === 'name') {
      if (!draft.name.trim()) {
        toast.error('Please enter an audience name.');
        return;
      }
      if (!draft.clientName?.trim()) {
        toast.error('Please enter a client name.');
        return;
      }

      // Initialize audience session on Partner Portal if not already done
      if (!draft.id) {
        setLoading(true);
        try {
          const { accountId, audienceId } = await apiClient.initVacuumAudience(draft.name);
          setDraft(prev => ({ ...prev, accountId, id: audienceId }));
          toast.success('Audience session ready');
        } catch (err) {
          console.error('Failed to init vacuum:', err);
          toast.error('Failed to initialize session on Partner Portal');
          setLoading(false);
          return;
        }
        setLoading(false);
      }
    }
    if (currentStep.id === 'intent') {
      if (!isKeywordRequirementMet) {
        setShowKeywordError(true);
        return;
      }
    }
    if (currentStep.id === 'location') {
      if (!isZipFormatValid) {
        setZipTouched(true);
        toast.error('Please ensure all ZIP codes are five digits separated by commas.');
        return;
      }
    }
    if (currentStep.id === 'personal') {
      if (!isMinAgeValid) {
        setMinAgeTouched(true);
        toast.error('Minimum age must be at least 18.');
        return;
      }
    }
    if (currentStep.id === 'financial' && mortgageInvalid) {
      toast.error('Mortgage amount minimum must be less than or equal to maximum.');
      return;
    }
    setCurrentStepIndex(prev => Math.min(prev + 1, steps.length - 1));
    scrollToTop();
  };


  const prewarmInitiated = useRef(false);
  const handleStartSession = useCallback(async () => {
    if (prewarmStatus === 'loading') return;

    setPrewarmStatus('loading');
    prewarmInitiated.current = true;

    try {
      await apiClient.prewarmVacuum();
      setPrewarmStatus('ready');
    } catch (err) {
      console.warn('Vacuum pre-warm failed:', err);
      setPrewarmStatus('error');
      prewarmInitiated.current = false;
    }
  }, [prewarmStatus]);

  useEffect(() => {
    // Pre-warm Vacuum session automatically on mount
    if (prewarmStatus === 'idle' && !prewarmInitiated.current) {
      handleStartSession();
    }
  }, [prewarmStatus, handleStartSession]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = (event: MediaQueryList | MediaQueryListEvent) => {
      setTheme(event.matches ? 'dark' : 'light');
    };
    updateTheme(mediaQuery);
    mediaQuery.addEventListener('change', updateTheme);
    return () => mediaQuery.removeEventListener('change', updateTheme);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const handleBack = () => {
    if (currentStepIndex === 0) {
      router.push('/');
      return;
    }
    setCurrentStepIndex(prev => Math.max(prev - 1, 0));
    scrollToTop();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const tag = target.tagName;
    if (tag === 'TEXTAREA' && event.shiftKey) {
      return;
    }
    if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !event.shiftKey) {
      event.preventDefault();
      if (currentStep.id === 'review') {
        handleSubmit();
      } else {
        handleNext();
      }
    }
  };

  const updateLocation = (field: keyof typeof locationForm, value: string) => {
    setLocationForm(prev => ({ ...prev, [field]: value }));
    setDraft(prev => ({
      ...prev,
      location: {
        ...prev.location,
        [field]: value
          .split(',')
          .map(token => token.trim())
          .filter(Boolean),
      },
    }));
  };

  const updateSectionField = <S extends keyof AudienceFilters, K extends keyof NonNullable<AudienceFilters[S]>>(
    section: S,
    field: K,
    value: any
  ) => {
    setDraft(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        [section]: {
          ...((prev.filters[section] as Record<string, any>) || {}),
          [field]: value,
        },
      },
    }));
  };

  const handleToggleField = <S extends keyof AudienceFilters>(section: S, field: keyof NonNullable<AudienceFilters[S]>, choice: ToggleChoice) => {
    updateSectionField(section, field as any, choice);
  };

  const normalizeZipInput = (rawValue: string) => {
    const cleaned = rawValue.replace(/[^0-9,\s]/g, '');
    const parts = cleaned
      .split(',')
      .map(part => part.trim())
      .filter(part => part.length > 0);
    const hasTrailingComma = /,\s*$/.test(cleaned);
    const rebuilt = parts.join(', ');
    if (hasTrailingComma) {
      return rebuilt ? `${rebuilt}, ` : '';
    }
    return rebuilt;
  };

  const handleZipChange = (rawValue: string) => {
    const normalized = normalizeZipInput(rawValue);
    updateLocation('zipCodes', normalized);
  };

  const handleZipKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Backspace') {
      return;
    }
    const input = event.currentTarget;
    const { selectionStart, selectionEnd, value } = input;
    if (selectionStart === null || selectionEnd === null) {
      return;
    }
    if (selectionStart !== selectionEnd) {
      return;
    }
    if (selectionStart < 2) {
      return;
    }
    const preceding = value.slice(selectionStart - 2, selectionStart);
    if (preceding === ', ') {
      event.preventDefault();
      const newValue = value.slice(0, selectionStart - 2) + value.slice(selectionStart);
      handleZipChange(newValue);
      const nextPos = selectionStart - 2;
      requestAnimationFrame(() => {
        input.setSelectionRange(nextPos, nextPos);
      });
    }
  };

  const renderBusinessStep = () => (
    <div className="space-y-4">
      {Object.entries(BUSINESS_FIELD_MAP).map(([label, fieldKey]) => {
        if (label === 'Job Titles' || label === 'Company Names' || label === 'Company Domains' || label === 'B2B Business Keywords') {
          const isDomain = label === 'Company Domains';
          const isKeywords = label === 'B2B Business Keywords';
          return (
            <KeywordChipInput
              key={label}
              label={label}
              beta={isKeywords}
              placeholder={
                label === 'Job Titles'
                  ? 'e.g. Senior Engineer, CEO...'
                  : isDomain
                    ? 'e.g. google.com, apple.com...'
                    : isKeywords
                      ? 'e.g. Marketing, Agency...'
                      : 'e.g. Google, Apple, Tesla...'
              }
              value={draft.filters.business?.[fieldKey] || []}
              onChange={(value) => updateSectionField('business', fieldKey, value)}
              maxItems={isDomain ? 10 : undefined}
              validate={isDomain ? (val) => val.includes('.') : undefined}
              errorText={isDomain ? 'Domains must include a TLD (e.g. .com, .io)' : undefined}
            />
          );
        }

        if (label === 'SIC Codes' || label === 'NAICS Codes' || label === 'Industries') {
          return (
            <SearchableMultiSelect
              key={label}
              label={label}
              options={getOptions('Business', label)}
              value={draft.filters.business?.[fieldKey] || []}
              onChange={(value) => updateSectionField('business', fieldKey, value)}
              placeholder={`Search ${label}...`}
            />
          );
        }
        return (
          <ChipMultiSelect
            key={label}
            label={label}
            options={getOptions('Business', label as string)}
            value={draft.filters.business?.[fieldKey]}
            onChange={(value) => updateSectionField('business', fieldKey, value)}
          />
        );
      })}
    </div>
  );

  const renderFinancialStep = () => (
    <div className="space-y-4">
      {Object.entries(FINANCIAL_FIELD_MAP).map(([label, fieldKey]) => (
        <ChipMultiSelect
          key={label}
          label={label}
          options={getOptions('Financial', label as string)}
          value={draft.filters.financial?.[fieldKey]}
          onChange={(value) => updateSectionField('financial', fieldKey, value)}
        />
      ))}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Mortgage Amount (Min)"
          type="number"
          value={draft.filters.financial?.mortgageAmount?.min?.toString() || ''}
          onChange={(e) =>
            updateSectionField('financial', 'mortgageAmount', {
              ...draft.filters.financial?.mortgageAmount,
              min: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
        <Input
          label="Mortgage Amount (Max)"
          type="number"
          value={draft.filters.financial?.mortgageAmount?.max?.toString() || ''}
          onChange={(e) =>
            updateSectionField('financial', 'mortgageAmount', {
              ...draft.filters.financial?.mortgageAmount,
              max: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
      </div>
      {mortgageInvalid && (
        <p className="text-xs text-red-600">
          Mortgage amount minimum cannot be greater than maximum.
        </p>
      )}
    </div>
  );

  const renderPersonalStep = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Min Age</label>
            {showMinAgeError && (
              <span className="text-xs text-red-600">Any minimum age must be 18 or older</span>
            )}
          </div>
          <Input
            type="number"
            value={draft.filters.personal?.ageRange?.min?.toString() || ''}
            className={showMinAgeError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : undefined}
            onChange={(e) => {
              const value = e.target.value ? Number(e.target.value) : undefined;
              updateSectionField('personal', 'ageRange', {
                ...draft.filters.personal?.ageRange,
                min: value,
              });
            }}
            onBlur={() => setMinAgeTouched(true)}
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Max Age</label>
          </div>
          <Input
            type="number"
            value={draft.filters.personal?.ageRange?.max?.toString() || ''}
            onChange={(e) =>
              updateSectionField('personal', 'ageRange', {
                ...draft.filters.personal?.ageRange,
                max: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </div>
      </div>
      {Object.entries(PERSONAL_FIELD_MAP).map(([label, fieldKey]) => (
        <ChipMultiSelect
          key={label}
          label={label}
          options={getOptions('Personal', label as string)}
          value={draft.filters.personal?.[fieldKey]}
          onChange={(value) => updateSectionField('personal', fieldKey, value)}
        />
      ))}
    </div>
  );

  const renderFamilyStep = () => (
    <div className="space-y-4">
      {Object.entries(FAMILY_FIELD_MAP).map(([label, fieldKey]) => (
        <ChipMultiSelect
          key={label}
          label={label}
          options={getOptions('Family', label as string)}
          value={draft.filters.family?.[fieldKey]}
          onChange={(value) =>
            updateSectionField('family', fieldKey, value)
          }
        />
      ))}
    </div>
  );

  const renderHousingStep = () => (
    <div className="space-y-4">
      {Object.entries(HOUSING_FIELD_MAP).map(([label, fieldKey]) => (
        <ChipMultiSelect
          key={label}
          label={label}
          options={getOptions('Housing', label as string)}
          value={draft.filters.housing?.[fieldKey]}
          onChange={(value) =>
            updateSectionField('housing', fieldKey, value)
          }
        />
      ))}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Year Built (Min)"
          type="number"
          value={draft.filters.housing?.yearBuilt?.min?.toString() || ''}
          onChange={(e) =>
            updateSectionField('housing', 'yearBuilt', {
              ...draft.filters.housing?.yearBuilt,
              min: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
        <Input
          label="Year Built (Max)"
          type="number"
          value={draft.filters.housing?.yearBuilt?.max?.toString() || ''}
          onChange={(e) =>
            updateSectionField('housing', 'yearBuilt', {
              ...draft.filters.housing?.yearBuilt,
              max: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
        <Input
          label="Purchase Year (Min)"
          type="number"
          value={draft.filters.housing?.purchaseYear?.min?.toString() || ''}
          onChange={(e) =>
            updateSectionField('housing', 'purchaseYear', {
              ...draft.filters.housing?.purchaseYear,
              min: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
        <Input
          label="Purchase Year (Max)"
          type="number"
          value={draft.filters.housing?.purchaseYear?.max?.toString() || ''}
          onChange={(e) =>
            updateSectionField('housing', 'purchaseYear', {
              ...draft.filters.housing?.purchaseYear,
              max: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Purchase Price (Min)"
          type="number"
          disabled={true}
          title="⚠️ Under Construction ⚠️"
          value={draft.filters.housing?.purchasePrice?.min?.toString() || ''}
          onChange={(e) =>
            updateSectionField('housing', 'purchasePrice', {
              ...draft.filters.housing?.purchasePrice,
              min: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
        <Input
          label="Purchase Price (Max)"
          type="number"
          value={draft.filters.housing?.purchasePrice?.max?.toString() || ''}
          onChange={(e) =>
            updateSectionField('housing', 'purchasePrice', {
              ...draft.filters.housing?.purchasePrice,
              max: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
      </div>
    </div>
  );

  const renderContactStep = () => (
    <div className="space-y-4">
      {requiredContactCount > 1 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-700 px-3 py-2 text-sm font-medium">
          More Filters = Smaller List
        </div>
      )}
      {Object.entries(CONTACT_FIELD_MAP).map(([label, fieldKey]) => (
        <ToggleField
          key={label}
          label={label}
          value={(draft.filters.contact?.[fieldKey] as ToggleChoice) || 'any'}
          onChange={(choice) => handleToggleField('contact', fieldKey, choice)}
        />
      ))}
    </div>
  );

  const reviewGroups = useMemo<ChipGroup[]>(() => {
    const groups: ChipGroup[] = [];
    const pushGroup = (id: string, label: string, chips: Chip[]) => {
      if (chips.length) {
        groups.push({ id, label, chips });
      }
    };

    const businessChips: Chip[] = [];
    Object.entries(BUSINESS_FIELD_MAP).forEach(([label, fieldKey]) => {
      businessChips.push(
        ...createChipsFromOptions('Business', label, draft.filters.business?.[fieldKey])
      );
    });
    pushGroup('business', 'Business Filters', businessChips);

    const financialChips: Chip[] = [];
    Object.entries(FINANCIAL_FIELD_MAP).forEach(([label, fieldKey]) => {
      financialChips.push(
        ...createChipsFromOptions('Financial', label, draft.filters.financial?.[fieldKey])
      );
    });
    addRangeChip(financialChips, 'Mortgage Amount', formatCurrencyRange(draft.filters.financial?.mortgageAmount), 'financial');
    pushGroup('financial', 'Financial Filters', financialChips);

    const personalChips: Chip[] = [];
    addRangeChip(personalChips, 'Age Range', formatNumericRange(draft.filters.personal?.ageRange), 'personal');
    Object.entries(PERSONAL_FIELD_MAP).forEach(([label, fieldKey]) => {
      personalChips.push(
        ...createChipsFromOptions('Personal', label, draft.filters.personal?.[fieldKey])
      );
    });
    pushGroup('personal', 'Personal Filters', personalChips);

    const familyChips: Chip[] = [];
    Object.entries(FAMILY_FIELD_MAP).forEach(([label, fieldKey]) => {
      familyChips.push(
        ...createChipsFromOptions('Family', label, draft.filters.family?.[fieldKey])
      );
    });
    pushGroup('family', 'Family Filters', familyChips);

    const housingChips: Chip[] = [];
    Object.entries(HOUSING_FIELD_MAP).forEach(([label, fieldKey]) => {
      housingChips.push(
        ...createChipsFromOptions('Housing', label, draft.filters.housing?.[fieldKey])
      );
    });
    addRangeChip(housingChips, 'Year Built', formatNumericRange(draft.filters.housing?.yearBuilt), 'housing');
    addRangeChip(housingChips, 'Purchase Price', formatCurrencyRange(draft.filters.housing?.purchasePrice), 'housing');
    addRangeChip(housingChips, 'Purchase Year', formatNumericRange(draft.filters.housing?.purchaseYear), 'housing');
    pushGroup('housing', 'Housing Filters', housingChips);

    const contactChips: Chip[] = [];
    Object.entries(CONTACT_FIELD_MAP).forEach(([label, fieldKey]) => {
      const value = draft.filters.contact?.[fieldKey];
      if (value && value !== 'any') {
        contactChips.push({
          key: `contact-${fieldKey}-${value}`,
          filterLabel: label,
          valueLabel: value === 'on' ? 'On' : 'Off',
        });
      }
    });
    pushGroup('contact', 'Contact Filters', contactChips);

    return groups;
  }, [draft]);

  const intentSummaryText = useMemo(() => {
    const segments: string[] = [];
    const append = (prefix: string, values: string[]) => {
      if (values.length) {
        segments.push(`${prefix} ${values.join(', ')}`);
      }
    };

    append(
      'industries',
      resolveLabels('Business', 'Industries', draft.filters.business?.industries)
    );
    append(
      'seniority',
      resolveLabels('Business', 'Seniority', draft.filters.business?.seniority)
    );
    append(
      'departments',
      resolveLabels('Business', 'Departments', draft.filters.business?.departments)
    );

    const locationSegments: string[] = [];
    if (draft.location.cities.length) {
      locationSegments.push(`cities ${draft.location.cities.join(', ')}`);
    }
    if (draft.location.states.length) {
      locationSegments.push(`states ${draft.location.states.join(', ')}`);
    }
    if (draft.location.zipCodes.length) {
      locationSegments.push(`ZIPs ${draft.location.zipCodes.join(', ')}`);
    }
    if (locationSegments.length) {
      segments.push(locationSegments.join('; '));
    }

    append(
      'income ranges',
      resolveLabels('Financial', 'Income Range', draft.filters.financial?.incomeRange)
    );
    append(
      'net worth',
      resolveLabels('Financial', 'Net Worth', draft.filters.financial?.netWorth)
    );
    append(
      'credit card users',
      resolveLabels('Financial', 'Credit Card User', draft.filters.financial?.creditCardUser)
    );
    const mortgageSummary = formatCurrencyRange(draft.filters.financial?.mortgageAmount);
    if (mortgageSummary) {
      segments.push(`mortgage amount ${mortgageSummary}`);
    }
    append(
      'occupation groups',
      resolveLabels('Financial', 'Occupation Group', draft.filters.financial?.occupationGroup)
    );
    append(
      'occupation types',
      resolveLabels('Financial', 'Occupation Type', draft.filters.financial?.occupationType)
    );

    return segments.length ? `You're targeting ${segments.join('; ')}.` : '';
  }, [draft]);

  const intentModeLabel = useMemo(() => {
    if (draft.intent.mode === 'none') {
      return 'SKIP';
    }
    return draft.intent.audienceType?.toUpperCase() ?? draft.intent.mode;
  }, [draft.intent.mode, draft.intent.audienceType]);

  const intentLevelLabel = useMemo(() => {
    if (!draft.intent.score) {
      return null;
    }
    const label = draft.intent.score.charAt(0).toUpperCase() + draft.intent.score.slice(1);
    return label;
  }, [draft.intent.score]);

  const trimmedKeywordLength = customKeywords.trim().length;
  const shouldValidateKeywords = draft.intent.mode === 'custom';
  const isKeywordRequirementMet = !shouldValidateKeywords || trimmedKeywordLength >= 10;
  const keywordErrorVisible = shouldValidateKeywords && showKeywordError && !isKeywordRequirementMet;
  const minAgeValue = draft.filters.personal?.ageRange?.min;
  const isMinAgeValid = minAgeValue === undefined || minAgeValue >= 18;
  const showMinAgeError = minAgeTouched && !isMinAgeValid;
  const requiredContactCount = useMemo(() => {
    const contactFilters = draft.filters.contact || {};
    return Object.values(contactFilters).filter(value => value === 'on').length;
  }, [draft.filters.contact]);

  const handleGenerateKeywords = async () => {
    if (!aiDescription.trim()) {
      toast.error('Please describe your target audience first.');
      return;
    }

    try {
      const response = await apiClient.generateIntent(aiDescription.trim(), draft);
      setCustomKeywords(response.keywords.join(', '));
      setDraft(prev => ({
        ...prev,
        intent: {
          ...prev.intent,
          keywords: response.keywords,
          mode: 'ai',
        },
      }));
      toast.success('AI keywords generated');
    } catch (error) {
      console.error('Failed to generate keywords', error);
      toast.error('AI generation failed. Please try again.');
    }
  };

  const handlePreview = async () => {
    setPreviewState({
      loading: true,
      count: null,
      preview: [],
      timestamp: null,
      status: 'pending'
    });

    try {
      // Map local draft to the structure expected by Vacuum (Partner API)
      const ACCOUNT_ID = draft.accountId || "27e2bf65-59ba-4a31-b754-97a6652fe36d";
      const AUDIENCE_ID = draft.id || "64d20fc9-7365-4bef-b586-dc4e16ba5f50";

      if (!draft.id) {
        toast.error('Audience not initialized. Please try starting the session again.');
        setPreviewState({
          loading: false,
          count: null,
          preview: [],
          timestamp: null,
          status: 'error',
          error: 'Audience not initialized'
        });
        return;
      }

      const formatFilterLabel = (label: string) => {
        if (label.includes(': ')) {
          return label.split(': ')[1].trim().toLowerCase();
        }
        return label.trim().toLowerCase();
      };

      const formatCurrencyLabel = (label: string) => {
        const lower = label.trim().toLowerCase();
        if (lower.startsWith('$')) return '$' + lower;
        if (/^\d/.test(lower)) return '$$' + lower;
        return lower;
      };

      const mappedPayload = {
        accountId: ACCOUNT_ID,
        id: AUDIENCE_ID,
        filters: {
          audience: {
            type: draft.intent.mode === 'premade' ? 'premade' :
              draft.intent.mode === 'ai' ? 'custom' :
                draft.intent.mode === 'custom' ? 'custom' : 'premade',
            b2b: null,
            customTopic: draft.intent.keywords.join(', '),
            customDescription: aiDescription || "",
            segmentSearches: []
          },
          jobId: "",
          segment: [],
          daysBack: null,
          score: draft.intent.score ? [draft.intent.score] : [],
          filters: {
            age: {
              minAge: draft.filters.personal?.ageRange?.min ?? null,
              maxAge: draft.filters.personal?.ageRange?.max ?? null
            },
            city: draft.location.cities,
            state: draft.location.states,
            zip: draft.location.zipCodes,
            // Mapping helper for selections (lowercasing is often required by the Partner API)
            gender: draft.filters.personal?.gender?.map(o => formatFilterLabel(o.label)) || [],
            profile: {
              incomeRange: draft.filters.financial?.incomeRange?.map(o => formatCurrencyLabel(o.label)) || [],
              homeowner: draft.filters.housing?.homeownerStatus?.map(o => formatFilterLabel(o.label)) || [],
              married: draft.filters.family?.married?.map(o => formatFilterLabel(o.label)) || [],
              netWorth: draft.filters.financial?.netWorth?.map(o => formatCurrencyLabel(o.label)) || [],
              children: draft.filters.family?.children?.map(o => formatFilterLabel(o.label)) || []
            },
            businessProfile: {
              companyDescription: draft.filters.business?.companyDescription?.map(o => o.label) || [],
              jobTitle: draft.filters.business?.jobTitles?.map(o => o.label) || [],
              seniority: draft.filters.business?.seniority?.map(o => o.label) || [],
              department: draft.filters.business?.departments?.map(o => o.label) || [],
              companyName: draft.filters.business?.companyName?.map(o => o.label) || [],
              companyDomain: draft.filters.business?.companyDomain?.map(o => o.label) || [],
              industry: draft.filters.business?.industries?.map(o => o.label) || [],
              sic: draft.filters.business?.sic?.map(o => o.label) || [],
              employeeCount: draft.filters.business?.employeeCount?.map(o => o.label) || [],
              companyRevenue: draft.filters.business?.companyRevenue?.map(o => o.label) || [],
              companyNaics: draft.filters.business?.companyNaics?.map(o => o.label) || []
            },
            attributes: {
              credit_rating: draft.filters.financial?.creditRating?.map(o => formatFilterLabel(o.label)) || [],
              language_code: draft.filters.personal?.language?.map(o => formatFilterLabel(o.label)) || [],
              occupation_group: draft.filters.financial?.occupationGroup?.map(o => formatFilterLabel(o.label)) || [],
              occupation_type: draft.filters.financial?.occupationType?.map(o => formatFilterLabel(o.label)) || [],
              home_year_built: {
                min: draft.filters.housing?.yearBuilt?.min ?? null,
                max: draft.filters.housing?.yearBuilt?.max ?? null
              },
              single_parent: draft.filters.family?.singleParent?.map(o => formatFilterLabel(o.label)) || [],
              cra_code: draft.filters.financial?.craCode?.map(o => formatFilterLabel(o.label)) || [],
              dwelling_type: draft.filters.housing?.dwellingType?.map(o => formatFilterLabel(o.label)) || [],
              credit_range_new_credit: draft.filters.financial?.newCreditRange?.map(o => o.label) || [],
              ethnic_code: draft.filters.personal?.ethnicity?.map(o => formatFilterLabel(o.label)) || [],
              marital_status: draft.filters.family?.maritalStatus?.map(o => formatFilterLabel(o.label)) || [],
              net_worth: [],
              education: draft.filters.personal?.education?.map(o => formatFilterLabel(o.label)) || [],
              credit_card_user: draft.filters.financial?.creditCardUser?.map(o => formatFilterLabel(o.label)) || [],
              investment: draft.filters.financial?.investment?.map(o => formatFilterLabel(o.label)) || [],
              smoker: draft.filters.personal?.smoker?.map(o => formatFilterLabel(o.label)) || [],
              home_purchase_price: {
                min: draft.filters.housing?.purchasePrice?.min ?? null,
                max: draft.filters.housing?.purchasePrice?.max ?? null
              },
              home_purchase_year: {
                min: draft.filters.housing?.purchaseYear?.min ?? null,
                max: draft.filters.housing?.purchaseYear?.max ?? null
              },
              estimated_home_value: draft.filters.housing?.estimatedHomeValue?.map(o => formatCurrencyLabel(o.label)) || [],
              mortgage_amount: {
                min: draft.filters.financial?.mortgageAmount?.min ?? null,
                max: draft.filters.financial?.mortgageAmount?.max ?? null
              },
              generations_in_household: draft.filters.family?.generationsInHousehold?.map(o => formatFilterLabel(o.label)) || []
            },
            // Map Contact toggles to the internal Partner Portal keys
            notNulls: Object.entries(draft.filters.contact || {})
              .filter(([_, v]) => v === 'on')
              .map(([key]) => {
                switch (key) {
                  case 'verifiedPersonalEmails': return 'PERSONAL_EMAILS_VALIDATION_STATUS';
                  case 'verifiedBusinessEmails': return 'BUSINESS_EMAILS_VALIDATION_STATUS';
                  case 'validPhones': return 'VALID_PHONES';
                  case 'skipTracedWireless': return 'SKIPTRACE_WIRELESS_NUMBERS';
                  case 'skipTracedWirelessB2B': return 'SKIPTRACE_B2B_PHONE';
                  default: return key.toUpperCase();
                }
              })
              .filter((k): k is string => k !== null),
            nullOnly: []
          }
        }
      };

      // @ts-ignore - The types between local draft and partner payload are intentionally decoupled
      const response = await apiClient.previewAudience(mappedPayload);

      if (response.success && response.data) {
        setPreviewState({
          loading: false,
          count: response.data.count,
          preview: response.data.preview || [],
          timestamp: new Date().toISOString(),
          status: 'ok',
          debug: response.debug
        });
      } else {
        throw new Error('Remote preview failed');
      }

    } catch (error) {
      console.error('Preview failed', error);
      setPreviewState({
        loading: false,
        count: null,
        preview: [],
        timestamp: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown preview error'
      });
      toast.error('Preview failed. Please try again.');
    }
  };

  const handleCopyFilters = async () => {
    try {
      const summary = buildFiltersSummary(draft, reviewGroups);

      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        toast.error('Clipboard is not available in this environment.');
        return;
      }

      await navigator.clipboard.writeText(summary);
      toast.success('Filters copied to clipboard');
    } catch (error) {
      console.error('Failed to copy filters', error);
      toast.error('Unable to copy filters. Please try again.');
    }
  };

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      toast.error('Audience name is required.');
      return;
    }

    if (!draft.clientName?.trim()) {
      toast.error('Client name is required.');
      return;
    }

    if (!hasAnyFilters(draft)) {
      toast.error('Select at least one filter before generating.');
      return;
    }

    setLoading(true);
    try {
      const audience = await apiClient.createAudience(draft);
      toast.success('Audience created successfully');
      router.push(`/audience/${audience.id}`);
    } catch (error) {
      console.error('Failed to create audience:', error);
      toast.error('Failed to create audience. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderIntentStep = () => (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <Target className="mx-auto text-primary-600 mb-2" size={48} />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Intent Targeting</h2>
        <p className="text-gray-600 dark:text-gray-400">Define how we should interpret buyer intent.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Intent Mode
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(
            SHOW_ADVANCED_INTENT_OPTIONS
              ? ([
                { id: 'custom', label: 'Keywords' },
                { id: 'ai', label: 'AI Generated' },
                { id: 'premade', label: 'Premade Library' },
                { id: 'none', label: 'Skip Intent' },
              ] as const)
              : ([
                { id: 'custom', label: 'Keywords' },
                { id: 'none', label: 'Skip Intent' },
              ] as const)
          ).map(mode => (
            <Button
              key={mode.id}
              variant={draft.intent.mode === mode.id ? 'primary' : 'secondary'}
              onClick={() =>
                setDraft(prev => ({
                  ...prev,
                  intent: {
                    ...prev.intent,
                    mode: mode.id,
                    keywords: mode.id === 'none' ? [] : prev.intent.keywords,
                  },
                }))
              }
            >
              {mode.label}
            </Button>
          ))}
        </div>
      </div>

      {draft.intent.mode !== 'none' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Audience Type
          </label>
          <div className="flex gap-2">
            {(['b2b', 'b2c'] as const).map(mode => (
              <Button
                key={mode}
                variant={draft.intent.audienceType === mode ? 'primary' : 'secondary'}
                fullWidth
                onClick={() =>
                  setDraft(prev => ({
                    ...prev,
                    intent: { ...prev.intent, audienceType: mode },
                  }))
                }
              >
                {mode.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
      )}

      {draft.intent.mode === 'custom' && (
        <>
          <label
            htmlFor={keywordsInputId}
            className="flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            <span>Keywords (comma-separated)</span>
            {keywordErrorVisible && (
              <span id={keywordsErrorId} className="text-xs font-normal text-red-600">
                Please enter at least 10 characters
              </span>
            )}
          </label>
          <Textarea
            id={keywordsInputId}
            aria-invalid={keywordErrorVisible}
            aria-describedby={keywordErrorVisible ? keywordsErrorId : undefined}
            placeholder="cloud computing, SaaS, HR software"
            rows={4}
            value={customKeywords}
            className={
              keywordErrorVisible
                ? 'border-red-300 text-red-900 placeholder-red-300 focus:ring-red-500 focus:border-red-500'
                : undefined
            }
            onChange={(e) => {
              const value = e.target.value;
              setCustomKeywords(value);
              setDraft(prev => ({
                ...prev,
                intent: {
                  ...prev.intent,
                  keywords: value
                    .split(',')
                    .map(token => token.trim())
                    .filter(Boolean),
                },
              }));
              if (value.trim().length >= 10 && showKeywordError) {
                setShowKeywordError(false);
              }
            }}
          />
        </>
      )}

      {SHOW_ADVANCED_INTENT_OPTIONS && draft.intent.mode === 'ai' && (
        <div className="space-y-3">
          <Textarea
            label="Describe your target audience"
            placeholder="Companies looking for cloud-based HR solutions for remote teams..."
            rows={5}
            value={aiDescription}
            onChange={(e) => setAiDescription(e.target.value)}
          />
          <Button variant="secondary" onClick={handleGenerateKeywords}>
            <Sparkles className="h-4 w-4 mr-1" /> Generate Keywords
          </Button>
        </div>
      )}

      {SHOW_ADVANCED_INTENT_OPTIONS && draft.intent.mode === 'premade' && (
        <MultiSelectField
          label={`Premade Topics (${draft.intent.audienceType?.toUpperCase()})`}
          options={PREMADE_TOPICS[draft.intent.audienceType || 'b2b']}
          value={draft.intent.premadeTopics}
          onChange={(value) =>
            setDraft(prev => ({
              ...prev,
              intent: {
                ...prev.intent,
                premadeTopics: value,
              },
            }))
          }
        />
      )}

      {draft.intent.mode !== 'none' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Intent Score
          </label>
          <div className="flex gap-2">
            {(['low', 'medium', 'high'] as const).map(score => (
              <Button
                key={score}
                variant={draft.intent.score === score ? 'primary' : 'secondary'}
                fullWidth
                onClick={() =>
                  setDraft(prev => ({
                    ...prev,
                    intent: {
                      ...prev.intent,
                      score,
                    },
                  }))
                }
              >
                {score.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Leave blank to skip intent targeting.
      </p>

      {intentSummaryText && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 text-left text-sm text-gray-700 dark:text-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Intent context summary
          </p>
          <p className="text-sm leading-relaxed">{intentSummaryText}</p>
        </div>
      )}
    </div>
  );


  const renderReviewStep = () => (
    <div className="space-y-4">
      <Card padding="md">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs uppercase text-gray-500">AUDIENCE NAME</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{draft.name || 'Not set'}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => goToStep('name')}>
            Change
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700 dark:text-gray-200">
          <div>
            <p className="font-medium mb-1">Location</p>
            {draft.location.cities.length > 0 && <p>Cities: {draft.location.cities.join(', ')}</p>}
            {draft.location.states.length > 0 && <p>States: {draft.location.states.join(', ')}</p>}
            {draft.location.zipCodes.length > 0 && <p>ZIPs: {draft.location.zipCodes.join(', ')}</p>}
            {draft.location.cities.length === 0 &&
              draft.location.states.length === 0 &&
              draft.location.zipCodes.length === 0 && (
                <p className="text-gray-500">No location filters</p>
              )}
          </div>
          {draft.intent.mode !== 'none' && (
            <div>
              <p className="font-medium mb-1">Intent</p>
              <p>Mode: {intentModeLabel}</p>
              {intentLevelLabel && <p>Intent Level: {intentLevelLabel}</p>}
              {draft.intent.keywords.length > 0 && <p>Keywords: {draft.intent.keywords.join(', ')}</p>}
              {draft.intent.premadeTopics?.length ? (
                <p>Premade: {draft.intent.premadeTopics.map(topic => topic.label).join(', ')}</p>
              ) : null}
            </div>
          )}
        </div>
      </Card>

      {reviewGroups.length > 0 && (
        <Card padding="md">
          <div
            className="flex items-center justify-between cursor-pointer select-none"
            onClick={() => setFiltersSummaryCollapsed(prev => !prev)}
          >
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-200">
              Selected Filters ({reviewGroups.reduce((n, g) => n + g.chips.length, 0)})
            </h3>
            <ChevronDown
              size={18}
              className={clsx(
                'text-gray-400 transition-transform duration-200',
                filtersSummaryCollapsed && '-rotate-90'
              )}
            />
          </div>
          {!filtersSummaryCollapsed && (
            <div className="space-y-4 mt-3">
              {reviewGroups.map(group => (
                <div key={group.id}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-200">
                      {group.label}
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToStep(REVIEW_GROUP_STEP_MAP[group.id] ?? 'review')}
                    >
                      Change
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.chips.map(chip => (
                      <span
                        key={chip.key}
                        className="inline-flex h-[30px] items-center rounded-md border border-gray-200 bg-gray-100 pl-3 pr-[6px] text-sm text-gray-900 max-w-[240px]"
                        title={`${chip.filterLabel}: ${chip.valueLabel}`}
                      >
                        <span className="font-medium mr-1 whitespace-nowrap">{chip.filterLabel}:</span>
                        <span className="truncate">{chip.valueLabel}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card padding="md" className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-gray-900 dark:text-white">Copy Filters</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopyFilters}
          >
            Copy Filters
          </Button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Copies a shareable summary of the selected intent and filters, grouped by section, for use in briefs, tickets, or notes.
        </p>
      </Card>

      {/* PREVIEW SECTION */}
      <Card padding="md" className="space-y-4 border-2 border-indigo-50 dark:border-indigo-900/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Audience Preview</p>
            <p className="text-xs text-gray-500">Verify your audience size and sample contacts.</p>
          </div>
          <Button variant="secondary" size="sm" loading={previewState.loading} onClick={handlePreview}>
            {previewState.status === 'idle' ? 'Run Preview' : 'Refresh Preview'}
          </Button>
        </div>

        {/* Count Display */}
        {!previewState.loading && previewState.count !== null && (
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-green-700 dark:text-green-400 font-semibold mb-1">Total Contacts Found</p>
              <p className="text-3xl font-bold text-green-800 dark:text-green-300">{previewState.count.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Last updated</p>
              <p className="text-xs font-mono">{new Date().toLocaleTimeString()}</p>
            </div>
          </div>
        )}

        {/* Preview Table */}
        {!previewState.loading && previewState.preview && previewState.preview.length > 0 && (
          <PreviewTable preview={previewState.preview} totalCount={previewState.count} />
        )}

        {/* Debug Panel */}
        {previewState.debug && (
          <details className="text-xs border-t pt-2 mt-2">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700 font-medium">Debug Details</summary>
            <div className="mt-2 bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-40 font-mono">
              <p><strong>Source:</strong> Remote</p>
              <p className="whitespace-pre-wrap"><strong>Raw Snippet:</strong> {previewState.debug.raw}</p>
            </div>
          </details>
        )}

        {previewState.error && (
          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded text-sm text-red-600 dark:text-red-400">
            Error: {previewState.error}
          </div>
        )}
      </Card>

    </div>
  );

  const renderStepContent = () => {
    switch (currentStep.id) {
      case 'name':
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Name Your Audience</h2>
              <p className="text-gray-600 dark:text-gray-400">
                Choose a descriptive name for your audience.
              </p>
            </div>
            <Input
              label="Audience Name"
              placeholder="e.g., Tech Startups in California"
              value={draft.name}
              onChange={(e) => setDraft(prev => ({ ...prev, name: e.target.value }))}
              onClear={() => setDraft(prev => ({ ...prev, name: '' }))}
              autoFocus
            />
            <Input
              label="Client Name"
              placeholder="e.g., Acme Corp"
              value={draft.clientName || ''}
              onChange={(e) => setDraft(prev => ({ ...prev, clientName: e.target.value }))}
              onClear={() => setDraft(prev => ({ ...prev, clientName: '' }))}
            />

            {/* Session Status Indicator */}
            <div className="mt-6 p-3 border rounded-lg flex items-center justify-between"
              style={{
                borderColor: prewarmStatus === 'ready' ? '#10b981' : prewarmStatus === 'error' ? '#ef4444' : '#d1d5db',
                backgroundColor: prewarmStatus === 'ready' ? '#f0fdf4' : prewarmStatus === 'error' ? '#fef2f2' : '#f9fafb'
              }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: prewarmStatus === 'ready' ? '#10b981' : prewarmStatus === 'loading' ? '#f59e0b' : prewarmStatus === 'error' ? '#ef4444' : '#9ca3af'
                  }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: '#111827' }}>
                    {prewarmStatus === 'ready' ? 'Session Ready' :
                      prewarmStatus === 'loading' ? 'Preparing Session...' :
                        prewarmStatus === 'error' ? 'Session Failed' : 'Session Idle'}
                  </p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>
                    {prewarmStatus === 'ready' ? 'Browser is logged in and ready' :
                      prewarmStatus === 'loading' ? 'Logging into Partner Portal...' :
                        prewarmStatus === 'error' ? 'Click to retry' : 'Waiting to start'}
                  </p>
                </div>
              </div>
              {(prewarmStatus === 'error' || prewarmStatus === 'idle') && (
                <Button
                  size="sm"
                  onClick={handleStartSession}
                >
                  Start Session
                </Button>
              )}
            </div>
          </div>
        );
      case 'location':
        return (
          <div className="space-y-4">
            <Input
              label="Cities"
              placeholder="San Francisco, New York, Austin"
              value={locationForm.cities}
              onChange={(e) => updateLocation('cities', e.target.value)}
              onClear={() => updateLocation('cities', '')}
            />
            <Input
              label="States (2-letter codes)"
              placeholder="CA, NY, TX"
              value={locationForm.states}
              onChange={(e) => updateLocation('states', e.target.value)}
              onClear={() => updateLocation('states', '')}
            />
            <div className="space-y-1">
              <label className="flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300">
                <span>ZIP Codes</span>
                {zipTouched && !isZipFormatValid && (
                  <span className="text-xs text-red-600">
                    Use five-digit ZIPs separated by commas (e.g., 94102, 10001)
                  </span>
                )}
              </label>
              <Input
                placeholder="94102, 10001, 78701"
                value={locationForm.zipCodes}
                className={zipTouched && !isZipFormatValid ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : undefined}
                onChange={(e) => handleZipChange(e.target.value)}
                onClear={() => handleZipChange('')}
                onKeyDown={handleZipKeyDown}
                onBlur={() => setZipTouched(true)}
              />
            </div>
            <p className="text-xs text-gray-500">Leave blank to skip location targeting.</p>
          </div>
        );
      case 'business':
        return renderBusinessStep();
      case 'financial':
        return renderFinancialStep();
      case 'personal':
        return renderPersonalStep();
      case 'family':
        return renderFamilyStep();
      case 'housing':
        return renderHousingStep();
      case 'contact':
        return renderContactStep();
      case 'intent':
        return renderIntentStep();
      case 'review':
        return renderReviewStep();
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen" onKeyDown={handleKeyDown}>
      <Header title="Create Audience" showCreateButton={false} />

      <main className="container mx-auto px-4 py-6 max-w-3xl">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={`flex-1 h-2 rounded-full mx-1 ${index <= currentStepIndex ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
              />
            ))}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
            Step {currentStepIndex + 1} of {steps.length}
          </p>
        </div>

        {/* Top navigation buttons, duplicated above the filters card.
            Back is hidden on the first step; Next/Create is also hidden on the first step
            so users advance using the bottom controls only on step 1. */}
        {currentStepIndex > 0 && (
          <div className="mb-4">
            <NavButtonRow>
              <Button variant="secondary" size="lg" onClick={handleBack} className="flex items-center">
                <ArrowLeft size={NAV_ICON_SIZE} className="mr-2" />
                Back
              </Button>
              {currentStep.id !== 'review' ? (
                <Button variant="primary" size="lg" onClick={handleNext} className="flex items-center justify-center">
                  Next
                  <ArrowRight size={NAV_ICON_SIZE} className="ml-2" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => setIsRequestModalOpen(true)}
                  className="flex items-center justify-center"
                >
                  Request Audience
                </Button>
              )}
            </NavButtonRow>
          </div>
        )}

        <Card padding="lg" className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <currentStep.icon className="text-primary-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{currentStep.label}</h2>
              <p className="text-sm text-gray-500">{currentStep.description}</p>
            </div>
          </div>
          {renderStepContent()}
        </Card>

        <NavButtonRow>
          {currentStepIndex > 0 && (
            <Button variant="secondary" size="lg" onClick={handleBack} className="flex items-center">
              <ArrowLeft size={NAV_ICON_SIZE} className="mr-2" />
              Back
            </Button>
          )}

          {currentStep.id !== 'review' ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth={currentStepIndex === 0}
              onClick={handleNext}
              className="flex items-center justify-center"
              disabled={!canProceedFromNameStep}
            >
              Next
              <ArrowRight size={NAV_ICON_SIZE} className="ml-2" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="flex items-center justify-center"
              onClick={() => setIsRequestModalOpen(true)}
            >
              Request Audience
            </Button>
          )}
        </NavButtonRow>
      </main>
      {isRequestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 shadow-2xl p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Audience Request Not Yet Received</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">We are in beta testing</p>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              Please press the copy button here and send us the resulting copied text to receive your audience. Allow 24-48 hours to receive your list.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIsRequestModalOpen(false)}>
                Close
              </Button>
              <Button variant="primary" onClick={handleCopyFilters}>
                Copy Filters
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
