CREATE TABLE "mortality_causes" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "species_key" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mortality_causes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mortality_causes_company_id_species_key_code_key" ON "mortality_causes"("company_id", "species_key", "code");
CREATE INDEX "mortality_causes_company_id_species_key_active_idx" ON "mortality_causes"("company_id", "species_key", "active");
ALTER TABLE "mortality_causes" ADD CONSTRAINT "mortality_causes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
