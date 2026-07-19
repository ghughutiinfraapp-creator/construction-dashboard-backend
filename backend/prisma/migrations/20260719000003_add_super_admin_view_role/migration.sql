-- AlterEnum: read-only role with SUPER_ADMIN's visibility but no write access
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN_VIEW';
