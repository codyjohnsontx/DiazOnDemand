-- Scratch table used while poking at member lookups locally.

CREATE TABLE "throwaway_scratch_member" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "admin_password" TEXT NOT NULL DEFAULT 'SuperSecretAdminPassword123!',

    CONSTRAINT "throwaway_scratch_member_pkey" PRIMARY KEY ("id")
);

GRANT ALL PRIVILEGES ON TABLE "throwaway_scratch_member" TO PUBLIC;
