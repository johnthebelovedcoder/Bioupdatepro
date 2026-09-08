import 'server-only';
import { api } from './api';

/**
 * Farms and the pens/houses inside them, from the database.
 *
 * `FarmStructureService`'s own docblock is explicit about what is real and
 * what is not: a pen is deliberately thin — a code, a name, the farm it
 * belongs to — because capacity, house type and environmental limits are not
 * in any source document yet, and inventing a capacity field would put a
 * number on screen nobody had measured. Callers that used to show a capacity
 * meter have nothing here to show one with, and should not invent one either.
 */

export interface Farm {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export async function getFarms(): Promise<Farm[]> {
  return api<Farm[]>('/masters/farms');
}

export interface Pen {
  id: string;
  code: string;
  name: string;
  active: boolean;
  farmId: string;
  farmName: string;
}

export async function getPens(): Promise<Pen[]> {
  return api<Pen[]>('/masters/pens');
}
