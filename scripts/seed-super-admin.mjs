import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = String(process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  if (!email) {
    throw new Error("ADMIN_EMAIL is required.");
  }

  await prisma.user.upsert({
    where: { email },
    update: {
      role: "super_admin",
      active: true,
    },
    create: {
      email,
      name: "Super Admin",
      role: "super_admin",
      active: true,
    },
  });

  console.log(`Super admin row ensured in Postgres for ${email}.`);
  console.log("Next: create a matching user in the AWS Cognito User Pool with this same email.");
  console.log("The Cognito user holds the password and MFA — Postgres only holds the role.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
