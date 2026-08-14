-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "boondId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "workUnit" TEXT NOT NULL,
    "projectBoondId" TEXT,
    "projectName" TEXT,
    "clientName" TEXT,
    "craState" TEXT,
    "craTerm" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_boondId_key" ON "TimeEntry"("boondId");

-- CreateIndex
CREATE INDEX "TimeEntry_personId_date_idx" ON "TimeEntry"("personId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_date_idx" ON "TimeEntry"("date");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
