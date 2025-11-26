import { AudienceFilters } from '../types';

export type BusinessOptionField = keyof NonNullable<AudienceFilters['business']>;
export type FinancialOptionField =
  | 'incomeRange'
  | 'netWorth'
  | 'creditRating'
  | 'newCreditRange'
  | 'investment'
  | 'craCode'
  | 'occupationGroup'
  | 'occupationType'
  | 'creditCardUser';
export type PersonalOptionField =
  | 'gender'
  | 'ethnicity'
  | 'language'
  | 'education'
  | 'smoker';
export type FamilyOptionField = keyof NonNullable<AudienceFilters['family']>;
export type HousingOptionField =
  | 'homeownerStatus'
  | 'dwellingType'
  | 'estimatedHomeValue';
export type ContactOptionField = keyof NonNullable<AudienceFilters['contact']>;

export const BUSINESS_FIELD_MAP: Record<string, BusinessOptionField> = {
  Seniority: 'seniority',
  Departments: 'departments',
  Industries: 'industries',
  'Employee Count': 'employeeCount',
  'Estimated Company Revenue': 'companyRevenue',
};

export const FINANCIAL_FIELD_MAP: Record<string, FinancialOptionField> = {
  'Income Range': 'incomeRange',
  'Net Worth': 'netWorth',
  'Credit Rating': 'creditRating',
  'New Credit Range': 'newCreditRange',
  Investment: 'investment',
  'CRA Code': 'craCode',
  'Occupation Group': 'occupationGroup',
  'Occupation Type': 'occupationType',
  'Credit Card User': 'creditCardUser',
};

export const PERSONAL_FIELD_MAP: Record<string, PersonalOptionField> = {
  Gender: 'gender',
  Ethnicity: 'ethnicity',
  Language: 'language',
  Education: 'education',
  Smoker: 'smoker',
};

export const FAMILY_FIELD_MAP: Record<string, FamilyOptionField> = {
  Married: 'married',
  'Marital Status': 'maritalStatus',
  'Single Parent': 'singleParent',
  'Generations in Household': 'generationsInHousehold',
  Children: 'children',
};

export const HOUSING_FIELD_MAP: Record<string, HousingOptionField> = {
  'Homeowner Status': 'homeownerStatus',
  'Dwelling Type': 'dwellingType',
  'Estimated Home Value': 'estimatedHomeValue',
};

export const CONTACT_FIELD_MAP: Record<string, ContactOptionField> = {
  'Verified Personal Emails': 'verifiedPersonalEmails',
  'Verified Business Emails': 'verifiedBusinessEmails',
  'Valid Phones': 'validPhones',
  'Skip Traced Wireless Phone Number': 'skipTracedWireless',
  'Skip Traced Wireless B2B Phone Number': 'skipTracedWirelessB2B',
};

export const CONTACT_FIELD_LABELS = Object.fromEntries(
  Object.entries(CONTACT_FIELD_MAP).map(([label, key]) => [key, label])
) as Record<ContactOptionField, string>;
