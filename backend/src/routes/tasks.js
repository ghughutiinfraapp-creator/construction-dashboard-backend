const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

// GET /api/tasks
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { projectId, status, assignedToId, page = 1, limit = 20 } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;
    if (req.user.role === 'SITE_ENGINEER') where.assignedToId = req.user.id;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        include: {
          project: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true, avatar: true } },
          createdBy: { select: { id: true, name: true } },
          _count: { select: { photos: true } }
        },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }]
      }),
      prisma.task.count({ where })
    ]);
    res.json({ tasks, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// POST /api/tasks
router.post('/', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { projectId, title, description, assignedToId, priority, startDate, dueDate } = req.body;
    const task = await prisma.task.create({
      data: {
        projectId, title, description, assignedToId, priority: priority || 'MEDIUM',
        createdById: req.user.id,
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      include: { assignedTo: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } }
    });

    // Notify assigned engineer
    if (assignedToId) {
      const notifier = new NotificationService(req.app.get('io'));
      await notifier.send({
        userId: assignedToId, title: 'New Task Assigned',
        body: `You have been assigned: "${title}" in ${task.project.name}`,
        type: 'TASK_ASSIGNED', entityType: 'task', entityId: task.id
      });
    }

    res.status(201).json({ task });
  } catch (error) { next(error); }
});

// PUT /api/tasks/:id/status
router.put('/:id/status', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body;
    const data = { status };
    if (status === 'COMPLETED') data.completedAt = new Date();

    const task = await prisma.task.update({
      where: { id: req.params.id }, data,
      include: { project: { select: { id: true, name: true, managerId: true } }, assignedTo: { select: { name: true } } }
    });

    // Notify PM on completion
    if (status === 'COMPLETED') {
      const notifier = new NotificationService(req.app.get('io'));
      await notifier.send({
        userId: task.project.managerId, title: 'Task Completed',
        body: `"${task.title}" completed by ${task.assignedTo?.name}`,
        type: 'TASK_UPDATED', entityType: 'task', entityId: task.id
      });
    }

    res.json({ task });
  } catch (error) { next(error); }
});

// PUT /api/tasks/:id
router.put('/:id', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const task = await prisma.task.update({ where: { id: req.params.id }, data: req.body });
    res.json({ task });
  } catch (error) { next(error); }
});

// DELETE /api/tasks/:id
router.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ message: 'Task deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
