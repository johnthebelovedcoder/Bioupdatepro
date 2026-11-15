export interface RoleCatalogueEntry {
  code: string;
  name: string;
  summary: string;
  canSeeMoney: boolean;
}

export interface RoleCatalogueResponse {
  roles: RoleCatalogueEntry[];
  assignableRoleCodes: string[];
}
