-- Rename Labourer -> SubContractor (data-preserving RENAME, not DROP/CREATE)
ALTER TABLE "labourers" RENAME TO "sub_contractors";

ALTER TABLE "labour_attendance" RENAME TO "sub_contractor_attendance";
ALTER TABLE "sub_contractor_attendance" RENAME COLUMN "labourer_id" TO "sub_contractor_id";

ALTER TABLE "labour_payments" RENAME TO "sub_contractor_payments";
ALTER TABLE "sub_contractor_payments" RENAME COLUMN "labourer_id" TO "sub_contractor_id";

-- Normalize LabourEntry table naming (was unmapped "LabourEntry", now snake_case)
-- and relax pricePerLabour to optional: new entries compute cost from individual
-- worker records via LabourAttendanceEntry instead of a single flat rate.
ALTER TABLE "LabourEntry" RENAME TO "labour_entries";
ALTER TABLE "labour_entries" ALTER COLUMN "pricePerLabour" DROP NOT NULL;
ALTER TABLE "labour_entries" ALTER COLUMN "labourCount" SET DEFAULT 0;
ALTER TABLE "labour_entries" ALTER COLUMN "totalCost" SET DEFAULT 0;

-- New tables: per-site labour roster + daily tick-mark attendance/cost log
CREATE TABLE "labour_master" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "tradeType" TEXT NOT NULL,
    "defaultWage" DOUBLE PRECISION NOT NULL,
    "aadhaarNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labour_master_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "labour_attendance_entries" (
    "id" TEXT NOT NULL,
    "labourEntryId" TEXT NOT NULL,
    "labourMasterId" TEXT NOT NULL,
    "wageAmount" DOUBLE PRECISION NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "totalCost" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labour_attendance_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "labour_master_projectId_idx" ON "labour_master"("projectId");
CREATE INDEX "labour_attendance_entries_labourEntryId_idx" ON "labour_attendance_entries"("labourEntryId");
CREATE INDEX "labour_attendance_entries_labourMasterId_idx" ON "labour_attendance_entries"("labourMasterId");
CREATE UNIQUE INDEX "labour_attendance_entries_labourEntryId_labourMasterId_key" ON "labour_attendance_entries"("labourEntryId", "labourMasterId");

ALTER TABLE "labour_master" ADD CONSTRAINT "labour_master_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "labour_attendance_entries" ADD CONSTRAINT "labour_attendance_entries_labourEntryId_fkey" FOREIGN KEY ("labourEntryId") REFERENCES "labour_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "labour_attendance_entries" ADD CONSTRAINT "labour_attendance_entries_labourMasterId_fkey" FOREIGN KEY ("labourMasterId") REFERENCES "labour_master"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cosmetic: align constraint/index names with the renamed tables (no data impact)
ALTER TABLE "labour_entries" RENAME CONSTRAINT "LabourEntry_pkey" TO "labour_entries_pkey";
ALTER TABLE "sub_contractor_attendance" RENAME CONSTRAINT "labour_attendance_pkey" TO "sub_contractor_attendance_pkey";
ALTER TABLE "sub_contractor_payments" RENAME CONSTRAINT "labour_payments_pkey" TO "sub_contractor_payments_pkey";
ALTER TABLE "sub_contractors" RENAME CONSTRAINT "labourers_pkey" TO "sub_contractors_pkey";

ALTER TABLE "labour_entries" RENAME CONSTRAINT "LabourEntry_createdById_fkey" TO "labour_entries_createdById_fkey";
ALTER TABLE "labour_entries" RENAME CONSTRAINT "LabourEntry_projectId_fkey" TO "labour_entries_projectId_fkey";
ALTER TABLE "sub_contractor_attendance" RENAME CONSTRAINT "labour_attendance_labourer_id_fkey" TO "sub_contractor_attendance_sub_contractor_id_fkey";
ALTER TABLE "sub_contractor_attendance" RENAME CONSTRAINT "labour_attendance_marked_by_id_fkey" TO "sub_contractor_attendance_marked_by_id_fkey";
ALTER TABLE "sub_contractor_attendance" RENAME CONSTRAINT "labour_attendance_project_id_fkey" TO "sub_contractor_attendance_project_id_fkey";
ALTER TABLE "sub_contractor_payments" RENAME CONSTRAINT "labour_payments_labourer_id_fkey" TO "sub_contractor_payments_sub_contractor_id_fkey";
ALTER TABLE "sub_contractor_payments" RENAME CONSTRAINT "labour_payments_recorded_by_id_fkey" TO "sub_contractor_payments_recorded_by_id_fkey";
ALTER TABLE "sub_contractors" RENAME CONSTRAINT "labourers_project_id_fkey" TO "sub_contractors_project_id_fkey";

ALTER INDEX "LabourEntry_createdById_idx" RENAME TO "labour_entries_createdById_idx";
ALTER INDEX "LabourEntry_date_idx" RENAME TO "labour_entries_date_idx";
ALTER INDEX "LabourEntry_projectId_idx" RENAME TO "labour_entries_projectId_idx";
ALTER INDEX "labour_attendance_labourer_id_date_key" RENAME TO "sub_contractor_attendance_sub_contractor_id_date_key";
