-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'FOREMAN';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "foremanId" TEXT;

-- CreateTable
CREATE TABLE "LabourEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "labourCount" INTEGER NOT NULL,
    "pricePerLabour" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabourEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabourEntry_projectId_idx" ON "LabourEntry"("projectId");

-- CreateIndex
CREATE INDEX "LabourEntry_createdById_idx" ON "LabourEntry"("createdById");

-- CreateIndex
CREATE INDEX "LabourEntry_date_idx" ON "LabourEntry"("date");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_foremanId_fkey" FOREIGN KEY ("foremanId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourEntry" ADD CONSTRAINT "LabourEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourEntry" ADD CONSTRAINT "LabourEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
