-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "kind" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "arrivalDate" DATE NOT NULL,
    "departureDate" DATE,
    "managerId" TEXT,
    "boondId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LongAbsence" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LongAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "share" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "note" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Person_boondId_key" ON "Person"("boondId");

-- CreateIndex
CREATE INDEX "Person_kind_idx" ON "Person"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Person_name_kind_key" ON "Person"("name", "kind");

-- CreateIndex
CREATE INDEX "LongAbsence_personId_idx" ON "LongAbsence"("personId");

-- CreateIndex
CREATE INDEX "Mission_personId_idx" ON "Mission"("personId");

-- CreateIndex
CREATE INDEX "Mission_client_idx" ON "Mission"("client");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LongAbsence" ADD CONSTRAINT "LongAbsence_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
