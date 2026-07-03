const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/notifications
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { unreadOnly, page = 1, limit = 30 } = req.query;
    const where = { userId: req.user.id };
    if (unreadOnly === 'true') where.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit), orderBy: { sentAt: 'desc' }
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } })
    ]);

    const issueIds = notifications
      .filter(n => n.entityType === 'issue' && n.entityId)
      .map(n => n.entityId);

    const deliveryIds = notifications
      .filter(n => n.entityType === 'delivery' && n.entityId)
      .map(n => n.entityId);

    let issuePhotosById = {};
    if (issueIds.length > 0) {
      const issues = await prisma.issue.findMany({
        where: { id: { in: issueIds } },
        select: { id: true, photoUrls: true }
      });
      issuePhotosById = Object.fromEntries(issues.map(i => [i.id, i.photoUrls]));
    }

    let deliveryPhotosById = {};
    if (deliveryIds.length > 0) {
      const photos = await prisma.photo.findMany({
        where: { deliveryId: { in: deliveryIds } },
        orderBy: { capturedAt: 'desc' },
        select: { deliveryId: true, url: true }
      });
      deliveryPhotosById = photos.reduce((acc, p) => {
        (acc[p.deliveryId] ||= []).push(p.url);
        return acc;
      }, {});
    }

    const notificationsWithPhoto = notifications.map(n => ({
      ...n,
      photoUrls:
        n.entityType === 'issue'    ? (issuePhotosById[n.entityId] || []) :
        n.entityType === 'delivery' ? (deliveryPhotosById[n.entityId] || []) :
        undefined
    }));

    res.json({ notifications: notificationsWithPhoto, total, unreadCount, page: parseInt(page) });
  } catch (error) { next(error); }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticate, async (req, res, next) => {
  try {
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json({ message: 'Marked as read' });
  } catch (error) { next(error); }
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticate, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) { next(error); }
});

module.exports = router;