const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

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

// POST /api/notifications/broadcast-to-clients
// Super Admin sends an arbitrary notification to: one specific client, the
// client attached to a specific project, or all clients.
// Body: { title, body, clientId? }             — specific client
//       { title, body, projectId? }            — the client on that project
//       { title, body }                        — every active client
// If both clientId and projectId are given, clientId wins.
router.post('/broadcast-to-clients', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { title, body, clientId, projectId } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

    const notifier = new NotificationService(req.app.get('io'));

    if (clientId) {
      const client = await prisma.user.findUnique({ where: { id: clientId }, select: { id: true, role: true, isActive: true } });
      if (!client || client.role !== 'CLIENT') return res.status(404).json({ error: 'Client not found' });
      if (!client.isActive) return res.status(400).json({ error: 'Client is not active' });

      const notification = await notifier.send({ userId: client.id, title, body, type: 'GENERAL' });
      return res.status(201).json({ message: 'Notification sent to 1 client', notifications: [notification] });
    }

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, clientId: true, client: { select: { id: true, isActive: true } } }
      });
      if (!project) return res.status(404).json({ error: 'Project not found' });
      if (!project.clientId || !project.client) return res.status(400).json({ error: 'This project has no client assigned' });
      if (!project.client.isActive) return res.status(400).json({ error: 'Client is not active' });

      const notification = await notifier.send({
        userId: project.client.id, title, body, type: 'GENERAL', entityType: 'project', entityId: project.id
      });
      return res.status(201).json({ message: 'Notification sent to 1 client', notifications: [notification] });
    }

    const notifications = await notifier.sendToRole({ role: 'CLIENT', title, body, type: 'GENERAL' });
    res.status(201).json({ message: `Notification sent to ${notifications.length} client(s)`, notifications });
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