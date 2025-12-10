import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const password = process.env.ADMIN_PASSWORD || 'admin1234'
  const hash = await bcrypt.hash(password, 10)

  // ensure admin user exists
  await prisma.user.upsert({
    where: { email: 'admin@washstore.local' },
    update: { password: hash },
    create: { email: 'admin@washstore.local', password: hash, role: 'ADMIN' },
  })

  console.log('Seed complete - admin user: admin@washstore.local')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
