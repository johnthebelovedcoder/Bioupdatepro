import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../../../web/src/lib/glossary';
import { routeExists } from '../helpers/web-routes';

/**
 * The in-app glossary (apps/web/src/lib/glossary.ts) against the client's
 * FARMING_GLOSSARY and BIO_TERMINOLOGY_SCREEN_MAP (workbook v8.9.8) —
 * AGE_GLOSSARY_CHECKS and BIO_MASTER_CHECKS.
 *
 * Each workbook term names the glossary entry that explains it; several
 * workbook terms share one entry (the snail and poultry mortality rates are
 * one idea). Every entry must say what it means and what the application
 * holds it to, and every screen it points at must exist.
 */

/** FARMING_GLOSSARY, rows 4–25: term → glossary entry. */
const FARMING_GLOSSARY: Record<string, string> = {
  'SnailPro Species': 'Species and breed',
  'SnailPro Cohort': 'Batch (cohort or flock)',
  'SnailPro Age basis': 'Hatch date and age basis',
  'SnailPro Age effective date': 'Age',
  'SnailPro Lifecycle stage': 'Stage',
  'SnailPro Hatch rate': 'Hatch rate',
  'SnailPro Mortality rate': 'Mortality',
  'SnailPro Market-ready': 'Market-ready',
  'SnailPro Processing yield': 'Processing yield',
  'PoultryPro Flock': 'Batch (cohort or flock)',
  'PoultryPro Placement': 'Placement',
  'PoultryPro FCR': 'FCR',
  'PoultryPro Hen-day production': 'Hen-day',
  'PoultryPro Mortality rate': 'Mortality',
  'PoultryPro Dressed yield': 'Dressed yield',
  'PoultryPro Cull': 'Cull',
  'AgriPro Biological asset': 'Biological asset',
  'AgriPro WIP': 'Work in progress (WIP)',
  'AgriPro Standard cost': 'Standard cost',
  'AgriPro Variance': 'Variance',
  'AgriPro Recovery': 'Recovery',
  'AgriPro Genealogy': 'Genealogy',
};

/** BIO_TERMINOLOGY_SCREEN_MAP, rows 4–29: term → glossary entry. */
const SCREEN_MAP: Record<string, string> = {
  'Cohort/Flock ID': 'Batch (cohort or flock)',
  'Species Code': 'Species and breed',
  'Scientific Name': 'Species and breed',
  'Breed Code': 'Species and breed',
  'Production Type': 'Production type',
  'Source Type': 'Source',
  'Purchase/Acquisition Date': 'Acquisition date and cost',
  'Birth/Hatch Date': 'Hatch date and age basis',
  'Age Basis': 'Hatch date and age basis',
  'Age Days/Weeks/Months': 'Age',
  'Configured Stage': 'Stage',
  'Suggested Stage': 'Suggested stage',
  'Current Quantity': 'Current number',
  'Mortality Event': 'Mortality',
  Condemnation: 'Condemnation',
  'Normal Loss': 'Normal and abnormal loss',
  'Abnormal Loss': 'Normal and abnormal loss',
  'Weight Event': 'Weighing',
  'Average Weight': 'Weighing',
  Biomass: 'Biomass',
  'Mortality Cause Code': 'Cause of death',
  'Closure Date': 'Closing date',
  'Farm/Pen/House': 'Farm, house and pen',
  'Responsible Supervisor': 'Responsible supervisor',
  'Parent Cohort/Flock': 'Parent batch',
  'Current Flag': 'Current weight',
};

describe('The glossary covers the workbook’s terms (AGE_GLOSSARY_CHECKS, BIO_MASTER_CHECKS)', () => {
  const byTerm = new Map(GLOSSARY.map((e) => [e.term, e]));

  it('defines every FARMING_GLOSSARY term (22)', () => {
    expect(Object.keys(FARMING_GLOSSARY)).toHaveLength(22);
    expect(Object.entries(FARMING_GLOSSARY).filter(([, entry]) => !byTerm.has(entry))).toEqual([]);
  });

  it('maps every BIO_TERMINOLOGY_SCREEN_MAP term (26)', () => {
    expect(Object.keys(SCREEN_MAP)).toHaveLength(26);
    expect(Object.entries(SCREEN_MAP).filter(([, entry]) => !byTerm.has(entry))).toEqual([]);
  });

  it('says what each term means and what the application holds it to, once each', () => {
    expect(GLOSSARY.filter((e) => e.meaning.length < 20 || e.rule.length < 20).map((e) => e.term)).toEqual([]);
    expect(new Set(GLOSSARY.map((e) => e.term)).size).toBe(GLOSSARY.length);
  });

  it('points only at screens that exist', () => {
    expect(GLOSSARY.filter((e) => e.where && !routeExists(e.where.href)).map((e) => `${e.term} → ${e.where!.href}`)).toEqual([]);
  });
});
