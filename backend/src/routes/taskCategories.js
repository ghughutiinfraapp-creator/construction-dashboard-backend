const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/task-categories
// Returns phase-level categories with their children.
// ?search=  — filters phases whose name matches OR that have a matching child item.
//             Matched child items are returned under their parent phase.
// ?all=true  — SUPER_ADMIN only, includes hidden entries.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const showAll   = req.user.role === 'SUPER_ADMIN' && req.query.all === 'true';
    const search    = req.query.search?.trim();
    const visFilter = showAll ? {} : { isVisible: true };

    if (search) {
      // Fetch phases that match by name, or whose children match by name
      const phases = await prisma.taskCategory.findMany({
        where: {
          parentId: null,
          ...visFilter,
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { children: { some: { name: { contains: search, mode: 'insensitive' }, ...visFilter } } },
          ],
        },
        include: {
          children: {
            where: {
              ...visFilter,
              name: { contains: search, mode: 'insensitive' },
            },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      });
      return res.json({ categories: phases });
    }

    const phases = await prisma.taskCategory.findMany({
      where: { parentId: null, ...visFilter },
      include: {
        children: { where: visFilter, orderBy: { order: 'asc' } },
      },
      orderBy: { order: 'asc' },
    });

    res.json({ categories: phases });
  } catch (error) { next(error); }
});

// GET /api/task-categories/flat
// Flat list of sub-category items — useful for dropdowns and search.
// ?search= filters by item name OR parent phase name (both directions).
router.get('/flat', authenticate, async (req, res, next) => {
  try {
    const showAll   = req.user.role === 'SUPER_ADMIN' && req.query.all === 'true';
    const search    = req.query.search?.trim();
    const visFilter = showAll ? {} : { isVisible: true };

    const items = await prisma.taskCategory.findMany({
      where: {
        parentId: { not: null },
        ...visFilter,
        ...(search ? {
          OR: [
            { name:   { contains: search, mode: 'insensitive' } },
            { parent: { name: { contains: search, mode: 'insensitive' } } },
          ],
        } : {}),
      },
      include: { parent: { select: { id: true, name: true } } },
      orderBy: [{ parent: { order: 'asc' } }, { order: 'asc' }],
    });

    res.json({ categories: items });
  } catch (error) { next(error); }
});

// POST /api/task-categories
router.post('/', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { name, parentId, order } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    if (parentId) {
      const parent = await prisma.taskCategory.findUnique({ where: { id: parentId } });
      if (!parent) return res.status(404).json({ error: 'Parent category not found' });
      if (parent.parentId) return res.status(400).json({ error: 'Only one level of nesting is allowed' });
    }

    const category = await prisma.taskCategory.create({
      data: { name: name.trim(), parentId: parentId || null, order: order ?? 0 },
    });
    res.status(201).json({ category });
  } catch (error) { next(error); }
});

// PUT /api/task-categories/:id
router.put('/:id', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { name, order } = req.body;
    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (order !== undefined) data.order = order;

    const category = await prisma.taskCategory.update({ where: { id: req.params.id }, data });
    res.json({ category });
  } catch (error) { next(error); }
});

// PATCH /api/task-categories/:id/visibility
router.patch('/:id/visibility', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const existing = await prisma.taskCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const category = await prisma.taskCategory.update({
      where: { id: req.params.id },
      data: { isVisible: !existing.isVisible },
    });
    res.json({ category });
  } catch (error) { next(error); }
});

// DELETE /api/task-categories/:id
router.delete('/:id', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    // Children are cascade-deleted via onDelete: Cascade on parentId
    await prisma.taskCategory.delete({ where: { id: req.params.id } });
    res.json({ message: 'Category deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
