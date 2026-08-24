import { Global, Module } from '@nestjs/common';
import { PartyService } from './party.service';
import { ItemService } from './item.service';
import { EmployeeService } from './employee.service';
import { RecipeService } from './recipe.service';
import { FarmStructureService } from './farm-structure.service';

/**
 * Master data (§5, §6, §7, §10).
 *
 * Global because everything from Phase 5 onward reads it: Processing explodes
 * recipes, Procure-to-Pay resolves suppliers and items, Payroll reads employee
 * salary components. One copy, shared.
 */
@Global()
@Module({
  providers: [PartyService, ItemService, EmployeeService, RecipeService, FarmStructureService],
  exports: [PartyService, ItemService, EmployeeService, RecipeService, FarmStructureService],
})
export class MastersModule {}
