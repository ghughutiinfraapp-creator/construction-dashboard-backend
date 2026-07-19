-- AlterEnum: track partial deliveries before a PO/Delivery is fully DELIVERED
ALTER TYPE "POStatus" ADD VALUE 'PARTIALLY_DELIVERED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'PARTIALLY_DELIVERED';

-- AlterTable: how much of each ordered item has actually been received so far
ALTER TABLE "po_items" ADD COLUMN "received_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;
