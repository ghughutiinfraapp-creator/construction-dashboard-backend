-- AlterTable: track how much of each PO item has been transferred out
ALTER TABLE "po_items" ADD COLUMN "transferred_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable: link a transfer PO back to the source PO
ALTER TABLE "purchase_orders" ADD COLUMN "transferred_from_id" TEXT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_transferred_from_id_fkey"
  FOREIGN KEY ("transferred_from_id") REFERENCES "purchase_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
