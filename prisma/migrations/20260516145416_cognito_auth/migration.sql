-- Make passwordHash nullable now that Cognito holds the credential.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Add cognitoSub: stable identifier from Cognito's `sub` claim, used to link
-- a Postgres User row to its Cognito identity even if the email changes.
ALTER TABLE "User" ADD COLUMN "cognitoSub" TEXT;
CREATE UNIQUE INDEX "User_cognitoSub_key" ON "User"("cognitoSub");
