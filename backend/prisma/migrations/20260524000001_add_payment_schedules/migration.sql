-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI', 'ONLINE');

-- AlterEnum: add payment notification types
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_RECEIVED';

-- CreateTable
CREATE TABLE "payment_schedules" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_installments" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "installment_no" INTEGER NOT NULL,
    "title" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "due_date" TIMESTAMP(3),
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "installment_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference_number" TEXT,
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one schedule per project
CREATE UNIQUE INDEX "payment_schedules_project_id_key" ON "payment_schedules"("project_id");

-- AddForeignKey
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "payment_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_installment_id_fkey"
    FOREIGN KEY ("installment_id") REFERENCES "payment_installments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_recorded_by_id_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
