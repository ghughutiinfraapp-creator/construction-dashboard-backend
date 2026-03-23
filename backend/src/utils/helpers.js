const prisma = require('../config/database');

async function generatePONumber() {
  const today = new Date();
  const prefix = `PO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;
  
  const lastPO = await prisma.purchaseOrder.findFirst({
    where: { poNumber: { startsWith: prefix } },
    orderBy: { createdAt: 'desc' },
    select: { poNumber: true }
  });

  let sequence = 1;
  if (lastPO) {
    const lastSeq = parseInt(lastPO.poNumber.split('-').pop(), 10);
    sequence = lastSeq + 1;
  }

  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

module.exports = { generatePONumber };
