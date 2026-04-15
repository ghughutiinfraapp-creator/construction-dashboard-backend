const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

/**
 * GET /api/foreman/sites
 * Returns all sites (projects) assigned to the logged-in foreman.
 */
router.get('/sites', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const sites = await prisma.project.findMany({
      where: {
        foremanId: req.user.id,
      },
      select: {
        id: true,
        name: true,
        location: true,
        status: true,
        startDate: true,
        endDate: true,
        manager: { select: { id: true, name: true } },
        _count: { select: { labourEntries: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ sites });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/foreman/sites/:siteId/labour
 * Returns all labour entries for a specific site.
 * Query params: page, limit, date (YYYY-MM-DD)
 */
router.get('/sites/:siteId/labour', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const { page = 1, limit = 20, date } = req.query;

    // Ensure the foreman is assigned to this site
    const site = await prisma.project.findFirst({
      where: { id: siteId, foremanId: req.user.id },
    });
    if (!site) {
      return res.status(403).json({ message: 'You are not assigned to this site.' });
    }

    const where = { projectId: siteId };
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      where.date = { gte: start, lt: end };
    }

    const [entries, total] = await Promise.all([
      prisma.labourEntry.findMany({
        where,
        skip: (page - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          createdBy: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.labourEntry.count({ where }),
    ]);

    const totalCost = entries.reduce(
      (sum, e) => sum + e.labourCount * e.pricePerLabour,
      0
    );

    res.json({
      entries,
      total,
      totalCost,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/foreman/sites/:siteId/labour
 * Creates a new labour entry for a site.
 * Body: { labourCount, pricePerLabour, date, notes? }
 */
router.post('/sites/:siteId/labour', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const { labourCount, pricePerLabour, date, notes } = req.body;

    if (!labourCount || !pricePerLabour || !date) {
      return res.status(400).json({
        message: 'labourCount, pricePerLabour and date are required.',
      });
    }

    // Ensure the foreman is assigned to this site
    const site = await prisma.project.findFirst({
      where: { id: siteId, foremanId: req.user.id },
      include: { manager: { select: { id: true, name: true } } },
    });
    if (!site) {
      return res.status(403).json({ message: 'You are not assigned to this site.' });
    }

    const totalCost = parseInt(labourCount) * parseFloat(pricePerLabour);

    const entry = await prisma.labourEntry.create({
      data: {
        projectId: siteId,
        createdById: req.user.id,
        labourCount: parseInt(labourCount),
        pricePerLabour: parseFloat(pricePerLabour),
        totalCost,
        date: new Date(date),
        notes: notes || null,
      },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    // Notify Project Manager about the new labour entry
    if (site.manager?.id) {
      const notifier = new NotificationService(req.app.get('io'));
      await notifier.send({
        userId: site.manager.id,
        title: 'Labour Entry Added',
        body: `${req.user.name} logged ${labourCount} labourers at ₹${pricePerLabour}/each for "${site.name}". Total: ₹${totalCost}`,
        type: 'LABOUR_ENTRY_CREATED',
        entityType: 'labourEntry',
        entityId: entry.id,
      });
    }

    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/foreman/labour/:entryId
 * Update a labour entry (only same-day edits allowed).
 */
router.put('/labour/:entryId', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { entryId } = req.params;
    const { labourCount, pricePerLabour, notes } = req.body;

    const existing = await prisma.labourEntry.findFirst({
      where: { id: entryId, createdById: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Entry not found or not yours.' });
    }

    // Only allow edits on the same calendar day
    const today = new Date();
    const entryDate = new Date(existing.date);
    const isSameDay =
      today.getFullYear() === entryDate.getFullYear() &&
      today.getMonth() === entryDate.getMonth() &&
      today.getDate() === entryDate.getDate();

    if (!isSameDay) {
      return res.status(403).json({ message: 'Labour entries can only be edited on the same day.' });
    }

    const updatedLabourCount = labourCount ?? existing.labourCount;
    const updatedPrice = pricePerLabour ?? existing.pricePerLabour;
    const totalCost = updatedLabourCount * updatedPrice;

    const entry = await prisma.labourEntry.update({
      where: { id: entryId },
      data: {
        labourCount: updatedLabourCount,
        pricePerLabour: updatedPrice,
        totalCost,
        notes: notes ?? existing.notes,
      },
    });

    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/foreman/labour/:entryId
 * Delete a labour entry (only same-day deletion allowed).
 */
router.delete('/labour/:entryId', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { entryId } = req.params;

    const existing = await prisma.labourEntry.findFirst({
      where: { id: entryId, createdById: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Entry not found or not yours.' });
    }

    const today = new Date();
    const entryDate = new Date(existing.date);
    const isSameDay =
      today.getFullYear() === entryDate.getFullYear() &&
      today.getMonth() === entryDate.getMonth() &&
      today.getDate() === entryDate.getDate();

    if (!isSameDay) {
      return res.status(403).json({ message: 'Labour entries can only be deleted on the same day.' });
    }

    await prisma.labourEntry.delete({ where: { id: entryId } });
    res.json({ message: 'Labour entry deleted.' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/foreman/sites/:siteId/labour/summary
 * Returns aggregated labour cost summary for a site.
 */
router.get('/sites/:siteId/labour/summary', authenticate, authorize('FOREMAN', 'PROJECT_MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { siteId } = req.params;

    const entries = await prisma.labourEntry.findMany({
      where: { projectId: siteId },
      select: { labourCount: true, pricePerLabour: true, totalCost: true, date: true },
    });

    const totalLabourDays = entries.reduce((sum, e) => sum + e.labourCount, 0);
    const totalCost = entries.reduce((sum, e) => sum + e.totalCost, 0);
    const avgPricePerLabour =
      entries.length > 0
        ? entries.reduce((sum, e) => sum + e.pricePerLabour, 0) / entries.length
        : 0;

    res.json({
      totalEntries: entries.length,
      totalLabourDays,
      totalCost,
      avgPricePerLabour: Math.round(avgPricePerLabour),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;