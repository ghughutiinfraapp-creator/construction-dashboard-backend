-- AlterTable
ALTER TABLE "labourers" DROP COLUMN "daily_wage",
ADD COLUMN     "amount_paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "proposed_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "labourers" ALTER COLUMN "proposed_amount" DROP DEFAULT;
