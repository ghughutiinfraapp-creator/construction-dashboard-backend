-- AlterEnum: add approval workflow states to InstallmentStatus
ALTER TYPE "InstallmentStatus" ADD VALUE 'REQUESTED';
ALTER TYPE "InstallmentStatus" ADD VALUE 'APPROVED';
ALTER TYPE "InstallmentStatus" ADD VALUE 'REJECTED';

-- AlterTable: add task linkage and approval tracking columns
ALTER TABLE "payment_installments" ADD COLUMN "requested_at" TIMESTAMP(3),
ADD COLUMN "requested_by_id" TEXT,
ADD COLUMN "task_id" TEXT;

-- AddForeignKey
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
