const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

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
    const vendor = await prisma.vendor.create({ data: req.body });
    res.status(201).json({ vendor });
  } catch (error) { next(error); }
});

// PUT /api/vendors/:id
router.put('/:id', authenticate, authorize('FINANCE', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data: req.body });
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
