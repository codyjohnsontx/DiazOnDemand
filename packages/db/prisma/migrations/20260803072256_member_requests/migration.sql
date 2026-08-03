-- CreateTable
CREATE TABLE "MemberRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberRequest_createdAt_idx" ON "MemberRequest"("createdAt");

-- CreateIndex
CREATE INDEX "MemberRequest_userId_idx" ON "MemberRequest"("userId");

-- AddForeignKey
ALTER TABLE "MemberRequest" ADD CONSTRAINT "MemberRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
