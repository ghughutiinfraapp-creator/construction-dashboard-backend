const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

// POST /api/suggestions
router.post('/', authenticate, authorize('CLIENT'), async (req, res, next) => {
  try {
    const { projectId, title, description } = req.body;
    if (!projectId || !title) return res.status(400).json({ error: 'projectId and title are required' });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, managerId: true }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const suggestion = await prisma.suggestion.create({
      data: { projectId, clientId: req.user.id, title, description },
      include: {
        client:  { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    // Notify project manager, site engineers on this project, and super admins
    const [siteEngineers, superAdmins] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'SITE_ENGINEER', attendance: { some: { projectId } }, isActive: true },
        select: { id: true }
      }),
      prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } })
    ]);

    const recipientIds = [
      project.managerId,
      ...siteEngineers.map(u => u.id),
      ...superAdmins.map(u => u.id)
    ].filter((id, i, arr) => arr.indexOf(id) === i); // deduplicate

    const notifier = new NotificationService(req.app.get('io'));
    await notifier.sendToMultiple({
      userIds: recipientIds,
      title: 'New Suggestion Submitted',
      body: `${req.user.name} submitted a suggestion on ${project.name}: "${title}"`,
      type: 'GENERAL',
      entityType: 'suggestion',
      entityId: suggestion.id
    });

    res.status(201).json({ suggestion });
  } catch (error) { next(error); }
});

// GET /api/suggestions
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { projectId, status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (status)    where.status    = status;
    if (req.user.role === 'CLIENT') where.clientId = req.user.id;

    const [suggestions, total] = await Promise.all([
      prisma.suggestion.findMany({
        where,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        include: {
          client:  { select: { id: true, name: true } },
          project: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.suggestion.count({ where })
    ]);

    res.json({ suggestions, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// GET /api/suggestions/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const suggestion = await prisma.suggestion.findUnique({
      where: { id: req.params.id },
      include: {
        client:  { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
    if (req.user.role === 'CLIENT' && suggestion.clientId !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });

    res.json({ suggestion });
  } catch (error) { next(error); }
});

// PUT /api/suggestions/:id — client can edit while PENDING; manager/admin can update status
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const suggestion = await prisma.suggestion.findUnique({ where: { id: req.params.id } });
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

    let data = {};
    if (req.user.role === 'CLIENT') {
      if (suggestion.clientId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
      if (suggestion.status !== 'PENDING') return res.status(400).json({ error: 'Cannot edit a reviewed suggestion' });
      const { title, description } = req.body;
      if (title) data.title = title;
      if (description !== undefined) data.description = description;
    } else {
      const { status } = req.body;
      if (status) data.status = status;
    }

    const updated = await prisma.suggestion.update({
      where: { id: req.params.id },
      data,
      include: {
        client:  { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    res.json({ suggestion: updated });
  } catch (error) { next(error); }
});

// DELETE /api/suggestions/:id — client (only PENDING), or admin
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const suggestion = await prisma.suggestion.findUnique({ where: { id: req.params.id } });
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

    if (req.user.role === 'CLIENT') {
      if (suggestion.clientId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
      if (suggestion.status !== 'PENDING') return res.status(400).json({ error: 'Cannot delete a reviewed suggestion' });
    }

    await prisma.suggestion.delete({ where: { id: req.params.id } });
    res.json({ message: 'Suggestion deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
