-- Incubators and their capacity (INT-025).

-- CreateTable
CREATE TABLE "incubators" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity_eggs" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incubators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "incubators_company_id_code_key" ON "incubators"("company_id", "code");


ALTER TABLE "incubators" ADD CONSTRAINT "incubators_capacity_check" CHECK ("capacity_eggs" > 0);
