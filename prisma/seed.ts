import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "dev@tubegen.local" },
    update: {},
    create: { email: "dev@tubegen.local", name: "TubeGen Development" },
  });

  await prisma.channel.upsert({
    where: { id: "dev-channel" },
    update: {},
    create: {
      id: "dev-channel",
      ownerId: user.id,
      name: "TubeGen Development Channel",
      language: "en",
      niche: "technology",
    },
  });
}

main().finally(async () => prisma.$disconnect());
