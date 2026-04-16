require('dotenv').config({ path: '.env.production' });
const { execSync } = require('child_process');
execSync('npx prisma migrate deploy', { stdio: 'inherit' });
