const COMMON_SUPERVISOR_ROLES = [
  'FARM_MANAGER',
  'PRODUCTION_SUPERVISOR',
  'PRODUCTION_LEAD',
] as const;

export function supervisorRolesForSpecies(speciesKey: string): string[] {
  const species = speciesKey.trim().toLowerCase();
  if (species === 'poultry') {
    return [...COMMON_SUPERVISOR_ROLES, 'POULTRY_SUPERVISOR'];
  }
  if (species === 'snail') {
    return [...COMMON_SUPERVISOR_ROLES, 'SNAIL_SUPERVISOR'];
  }
  return [...COMMON_SUPERVISOR_ROLES];
}
