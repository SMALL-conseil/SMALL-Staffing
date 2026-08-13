-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "fees" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'CONSULTANT';

-- Migration des rôles applicatifs existants (MEMBER/ADMIN → CONSULTANT/SIEGE)
UPDATE "User" SET "role" = 'SIEGE' WHERE "role" = 'ADMIN';
UPDATE "User" SET "role" = 'CONSULTANT' WHERE "role" = 'MEMBER';
