const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/materials/catalog
// Returns all active catalog items. Optional filters: category, search
router.get('/catalog', authenticate, async (req, res, next) => {
  try {
    const { category, search, includeInactive } = req.query;
    const where = {};

    // Only admins can see inactive items
    if (includeInactive === 'true' && ['SUPER_ADMIN', 'PROJECT_MANAGER'].includes(req.user.role)) {
      // no isActive filter — return all
    } else {
      where.isActive = true;
    }

    if (category) where.category = { equals: category, mode: 'insensitive' };
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const items = await prisma.materialCatalog.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }]
    });
    res.json({ items });
  } catch (error) { next(error); }
});

// GET /api/materials/catalog/categories
// Returns list of distinct categories (useful for filter dropdowns)
router.get('/catalog/categories', authenticate, async (req, res, next) => {
  try {
    const result = await prisma.materialCatalog.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' }
    });
    res.json({ categories: result.map(r => r.category) });
  } catch (error) { next(error); }
});

// GET /api/materials/catalog/:id
router.get('/catalog/:id', authenticate, async (req, res, next) => {
  try {
    const item = await prisma.materialCatalog.findUnique({
      where: { id: req.params.id }
    });
    if (!item) return res.status(404).json({ error: 'Material not found' });
    res.json({ item });
  } catch (error) { next(error); }
});

// POST /api/materials/catalog (Admin / PM only)
router.post('/catalog', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { name, category, unit, defaultPrice, brands } = req.body;
    if (!name || !category || !unit) {
      return res.status(400).json({ error: 'name, category, and unit are required' });
    }
    const item = await prisma.materialCatalog.create({
      data: {
        name,
        category,
        unit,
        defaultPrice: defaultPrice ? parseFloat(defaultPrice) : null,
        brands: brands || []
      }
    });
    res.status(201).json({ item });
  } catch (error) { next(error); }
});

// PUT /api/materials/catalog/:id (Admin / PM only)
router.put('/catalog/:id', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { name, category, unit, defaultPrice, brands, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (category !== undefined) data.category = category;
    if (unit !== undefined) data.unit = unit;
    if (defaultPrice !== undefined) data.defaultPrice = defaultPrice ? parseFloat(defaultPrice) : null;
    if (brands !== undefined) data.brands = brands;
    if (isActive !== undefined) data.isActive = isActive;

    const item = await prisma.materialCatalog.update({
      where: { id: req.params.id },
      data
    });
    res.json({ item });
  } catch (error) { next(error); }
});

// DELETE /api/materials/catalog/:id  — soft delete (sets isActive = false)
router.delete('/catalog/:id', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    await prisma.materialCatalog.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ message: 'Material deactivated successfully' });
  } catch (error) { next(error); }
});

module.exports = router;
