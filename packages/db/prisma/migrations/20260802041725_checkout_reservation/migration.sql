-- CreateTable
CREATE TABLE "CheckoutReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutReservation_userId_key" ON "CheckoutReservation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutReservation_stripeSessionId_key" ON "CheckoutReservation"("stripeSessionId");

-- CreateIndex
CREATE INDEX "CheckoutReservation_expiresAt_idx" ON "CheckoutReservation"("expiresAt");

-- AddForeignKey
ALTER TABLE "CheckoutReservation" ADD CONSTRAINT "CheckoutReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
