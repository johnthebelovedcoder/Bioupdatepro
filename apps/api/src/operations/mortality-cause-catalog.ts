export const DEFAULT_MORTALITY_CAUSES: Record<string, string[]> = {
  poultry: ['Heat stress', 'Disease', 'Predation', 'Injury', 'Culled', 'Unknown'],
  snail: ['Desiccation', 'Disease', 'Predation', 'Overcrowding', 'Escaped', 'Unknown'],
  fish: ['Disease', 'Water quality', 'Predation', 'Handling', 'Unknown'],
  dairy: ['Disease', 'Calving complication', 'Injury', 'Culled', 'Unknown'],
  pig: ['Disease', 'Farrowing loss', 'Injury', 'Culled', 'Unknown'],
  goat: ['Disease', 'Kidding complication', 'Predation', 'Culled', 'Unknown'],
  rabbit: ['Disease', 'Kindling loss', 'Heat stress', 'Culled', 'Unknown'],
};

export function mortalityCauseRows(companyId: string, speciesKey?: string) {
  return Object.entries(DEFAULT_MORTALITY_CAUSES)
    .filter(([species]) => !speciesKey || species === speciesKey)
    .flatMap(([speciesKey, labels]) => labels.map((label) => ({
      companyId,
      speciesKey,
      code: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
      label,
    })));
}
