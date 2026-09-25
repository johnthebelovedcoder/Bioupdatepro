-- AlterTable
ALTER TABLE "species_breed_stages" ADD COLUMN     "target_weight_grams" INTEGER;

-- AlterTable
ALTER TABLE "livestock_groups" ADD COLUMN     "hatch_date_estimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hatched_on" DATE;

-- AlterTable
ALTER TABLE "livestock_group_disposals" ADD COLUMN     "method" TEXT;

-- AlterTable
ALTER TABLE "mortality_records" ADD COLUMN     "carcass_disposal" TEXT;

-- CreateTable
CREATE TABLE "livestock_weighings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "weighed_on" DATE NOT NULL,
    "stage" TEXT NOT NULL,
    "age_days" INTEGER NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "total_sample_weight_grams" INTEGER NOT NULL,
    "average_weight_grams" INTEGER NOT NULL,
    "target_weight_grams" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'g',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "notes" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "daily_record_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livestock_weighings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "livestock_weighings_group_id_weighed_on_idx" ON "livestock_weighings"("group_id", "weighed_on");

-- CreateIndex
CREATE INDEX "livestock_weighings_company_id_status_idx" ON "livestock_weighings"("company_id", "status");

-- AddForeignKey
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A weighing weighs something: at least one animal, at a positive weight.
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_sample_positive" CHECK ("sample_size" > 0);
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_weight_positive"
  CHECK ("total_sample_weight_grams" > 0 AND "average_weight_grams" > 0);
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_status_known"
  CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_unit_known" CHECK ("unit" IN ('g', 'kg'));
-- Only an approved weighing can be current, and a batch has at most one.
ALTER TABLE "livestock_weighings" ADD CONSTRAINT "livestock_weighings_current_is_approved"
  CHECK (NOT "is_current" OR "status" = 'APPROVED');
CREATE UNIQUE INDEX "livestock_weighings_one_current" ON "livestock_weighings"("group_id") WHERE "is_current";

-- The words the application offers, and nothing else; blank on older rows.
ALTER TABLE "livestock_group_disposals" ADD CONSTRAINT "livestock_group_disposals_method_known"
  CHECK ("method" IS NULL OR "method" IN ('SOLD', 'SLAUGHTERED', 'CULLED', 'GIFTED', 'DESTROYED'));
ALTER TABLE "mortality_records" ADD CONSTRAINT "mortality_records_carcass_disposal_known"
  CHECK ("carcass_disposal" IS NULL OR "carcass_disposal" IN ('BURIED', 'BURNT', 'RENDERED', 'COLLECTED', 'OTHER'));

