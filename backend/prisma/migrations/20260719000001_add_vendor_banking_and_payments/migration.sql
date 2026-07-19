-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "bank_name" TEXT,
ADD COLUMN "account_number" TEXT,
ADD COLUMN "ifsc_code" TEXT,
ADD COLUMN "account_holder_name" TEXT;

-- CreateTable
CREATE TABLE "vendor_payments" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "receipt_number" TEXT,
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
