-- CreateTable
CREATE TABLE "BarredEmail" (
    "fingerprint" CHAR(64) NOT NULL,
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarredEmail_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateIndex
CREATE INDEX "BarredEmail_until_idx" ON "BarredEmail"("until");

