const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/photos
// Filters: projectId, entityType, taskId, purchaseOrderId, deliveryId, uploadedById
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { projectId, entityType, taskId, purchaseOrderId, deliveryId, uploadedById, page = 1, limit = 20 } = req.query;

    const where = {};
    if (projectId)      where.projectId      = projectId;
    if (entityType)     where.entityType     = entityType;
    if (taskId)         where.taskId         = taskId;
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;
    if (deliveryId)     where.deliveryId     = deliveryId;
    if (uploadedById)   where.uploadedById   = uploadedById;

    const [photos, total] = await Promise.all([
      prisma.photo.findMany({
        where,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        include: {
          uploadedBy: { select: { id: true, name: true } },
          project:    { select: { id: true, name: true } },
          task:       { select: { id: true, title: true } },
        },
        orderBy: { capturedAt: 'desc' }
      }),
      prisma.photo.count({ where })
    ]);

    res.json({ photos, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// GET /api/photos/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
      include: {
        uploadedBy:    { select: { id: true, name: true } },
        project:       { select: { id: true, name: true } },
        task:          { select: { id: true, title: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        delivery:      { select: { id: true } },
      }
    });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    res.json({ photo });
  } catch (error) { next(error); }
});

module.exports = router;
