-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoutingResourceType" ADD VALUE 'OVERHEAD';
ALTER TYPE "RoutingResourceType" ADD VALUE 'DEPRECIATION';

-- AlterTable
ALTER TABLE "standard_cost_versions" ADD COLUMN     "depreciation_kobo" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "overhead_kobo" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "packaging_kobo" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "product_recipe_components" ADD COLUMN     "component_type" TEXT NOT NULL DEFAULT 'MATERIAL';


ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_type_known" CHECK ("component_type" IN ('MATERIAL', 'PACKAGING'));

-- The total is the six parts of POL-003, not three.
ALTER TABLE "standard_cost_versions" DROP CONSTRAINT "standard_cost_versions_amounts";
ALTER TABLE "standard_cost_versions" ADD CONSTRAINT "standard_cost_versions_amounts" CHECK (
  "material_kobo" >= 0 AND "packaging_kobo" >= 0 AND "labour_kobo" >= 0 AND "machine_kobo" >= 0
  AND "overhead_kobo" >= 0 AND "depreciation_kobo" >= 0
  AND "total_kobo" = "material_kobo" + "packaging_kobo" + "labour_kobo" + "machine_kobo" + "overhead_kobo" + "depreciation_kobo"
  AND "unit_cost_kobo" >= 0 AND "output_quantity" > 0);
