/**
 * Creates (or updates) a single SUPER_ADMIN user.
 *
 * Unlike prisma/seed.js this script is non-destructive: it touches only the one
 * user row and never calls deleteMany. It also never hardcodes or logs a password.
 *
 * Usage:
 *   node scripts/create-admin.js                  # prompts for the password
 *   ADMIN_PASSWORD='...' node scripts/create-admin.js
 *
 * Target database comes from ENV_FILE (default .env.production).
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.production' });

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const EMAIL = process.env.ADMIN_EMAIL || 'ghughutiinfra@gmail.com';
const NAME = process.env.ADMIN_NAME || 'Ghughuti Infra Admin';
const MIN_LENGTH = 12;

const prisma = new PrismaClient();

/** Reads a password from the tty without echoing it back. */
function promptPassword(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Not a TTY - set ADMIN_PASSWORD instead.'));
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const hide = () => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(label);
    };
    process.stdin.on('data', hide);
    rl.question(label, (answer) => {
      process.stdin.removeListener('data', hide);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  let password = process.env.ADMIN_PASSWORD;

  if (!password) {
    password = await promptPassword('Admin password: ');
    const confirm = await promptPassword('Confirm password: ');
    if (password !== confirm) throw new Error('Passwords do not match.');
  }

  if (!password || password.length < MIN_LENGTH) {
    throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
  }
  if (/password|123456|qwerty|admin@/i.test(password)) {
    throw new Error('Password is too predictable. Choose something else.');
  }

  const hashed = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { password: hashed, role: 'SUPER_ADMIN', isActive: true },
    create: { name: NAME, email: EMAIL, password: hashed, role: 'SUPER_ADMIN' },
  });

  const host = (process.env.DIRECT_URL || '').replace(/^.*@/, '').replace(/\/.*$/, '');
  console.log(`\nSUPER_ADMIN ready: ${user.email}`);
  console.log(`  id: ${user.id}`);
  console.log(`  db: ${host || 'unknown'}`);
  console.log('  Password was not logged.\n');
}

main()
  .catch((e) => {
    console.error(`\nFailed: ${e.message}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
