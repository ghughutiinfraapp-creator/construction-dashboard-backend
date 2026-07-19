const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Validates that credit/paid, if present in the body, are real numbers before
// they hit Prisma's Decimal columns (NaN there produces a confusing error).
function parseCreditPaid(body) {
  const data = { ...body };
  for (const field of ['credit', 'paid']) {
    if (data[field] === undefined) continue;
    const parsed = parseFloat(data[field]);
    if (isNaN(parsed)) return { error: `${field} must be a valid number` };
    data[field] = parsed;
  }
  return { data };
}

// GET /api/vendors
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { search, category } = req.query;
    const where = { isActive: true };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (category) where.categories = { has: category };

    const vendors = await prisma.vendor.findMany({
      where, orderBy: { name: 'asc' },
      include: { _count: { select: { purchaseOrders: true } } }
    });
    res.json({ vendors });
  } catch (error) { next(error); }
});

// POST /api/vendors
router.post('/', authenticate, authorize('FINANCE', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { data, error } = parseCreditPaid(req.body);
    if (error) return res.status(400).json({ error });

    const vendor = await prisma.vendor.create({ data });
    res.status(201).json({ vendor });
  } catch (error) { next(error); }
});

// PUT /api/vendors/:id
router.put('/:id', authenticate, authorize('FINANCE', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { data, error } = parseCreditPaid(req.body);
    if (error) return res.status(400).json({ error });

    const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data });
    res.json({ vendor });
  } catch (error) { next(error); }
});

// GET /api/vendors/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrders: {
          take: 10, orderBy: { createdAt: 'desc' },
          select: { id: true, poNumber: true, status: true, totalAmount: true, createdAt: true }
        },
        _count: { select: { purchaseOrders: true } }
      }
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ vendor });
  } catch (error) { next(error); }
});

module.exports = router;
