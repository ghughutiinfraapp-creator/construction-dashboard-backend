const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

// GET /api/tasks
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { projectId, status, assignedToId, page = 1, limit = 20 } = req.query;
    const where = { parentId: null }; // Only top-level tasks by default
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;
    if (req.user.role === 'SITE_ENGINEER') where.assignedToId = req.user.id;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        include: {
          project: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true, avatar: true } },
          createdBy: { select: { id: true, name: true } },
          subtasks: {
            include: {
              assignedTo: { select: { id: true, name: true, avatar: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
          _count: { select: { photos: true, subtasks: true } },
        },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
      }),
      prisma.task.count({ where }),
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
        projectId,
        title,
        description,
        assignedToId,
        priority: priority || 'MEDIUM',
        createdById: req.user.id,
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    if (assignedToId) {
      const notifier = new NotificationService(req.app.get('io'));
      await notifier.send({
        userId: assignedToId,
        title: 'New Task Assigned',
        body: `You have been assigned: "${title}" in ${task.project.name}`,
        type: 'TASK_ASSIGNED',
        entityType: 'task',
        entityId: task.id,
      });
    }

    res.status(201).json({ task });
  } catch (error) { next(error); }
});

// POST /api/tasks/:id/subtasks — create a subtask under a parent task
router.post('/:id/subtasks', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const parent = await prisma.task.findUnique({
      where: { id: req.params.id },
      select: { id: true, projectId: true, project: { select: { name: true } } },
    });
    if (!parent) return res.status(404).json({ error: 'Parent task not found' });

    const { title, description, assignedToId, priority, startDate, dueDate } = req.body;
    const subtask = await prisma.task.create({
      data: {
        projectId: parent.projectId,
        parentId: parent.id,
        title,
        description,
        assignedToId,
        priority: priority || 'MEDIUM',
        createdById: req.user.id,
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
      },
    });

    if (assignedToId) {
      const notifier = new NotificationService(req.app.get('io'));
      await notifier.send({
        userId: assignedToId,
        title: 'New Subtask Assigned',
        body: `You have been assigned a subtask: "${title}" in ${parent.project.name}`,
        type: 'TASK_ASSIGNED',
        entityType: 'task',
        entityId: subtask.id,
      });
    }

    res.status(201).json({ subtask });
  } catch (error) { next(error); }
});

// GET /api/tasks/:id/subtasks — list subtasks of a task
router.get('/:id/subtasks', authenticate, async (req, res, next) => {
  try {
    const subtasks = await prisma.task.findMany({
      where: { parentId: req.params.id },
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { photos: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ subtasks });
  } catch (error) { next(error); }
});

// PUT /api/tasks/:id/status — update task or subtask status
router.put('/:id/status', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body;
    const data = { status };
    if (status === 'COMPLETED') data.completedAt = new Date();

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data,
      include: {
        project: { select: { id: true, name: true, managerId: true } },
        assignedTo: { select: { name: true } },
        parent: { select: { id: true, title: true } },
      },
    });

    // Auto-update parent task status based on subtasks
    if (task.parentId) {
      const siblings = await prisma.task.findMany({
        where: { parentId: task.parentId },
        select: { status: true },
      });
      const allDone = siblings.every(s => s.status === 'COMPLETED' || s.status === 'VERIFIED');
      const anyInProgress = siblings.some(s => s.status === 'IN_PROGRESS');
      const anyBlocked = siblings.some(s => s.status === 'BLOCKED');

      let parentStatus = 'TODO';
      if (allDone) parentStatus = 'COMPLETED';
      else if (anyBlocked) parentStatus = 'BLOCKED';
      else if (anyInProgress) parentStatus = 'IN_PROGRESS';

      await prisma.task.update({
        where: { id: task.parentId },
        data: { status: parentStatus, completedAt: allDone ? new Date() : null },
      });
    }

    // Notify PM on task/subtask completion
    if (status === 'COMPLETED' && task.project.managerId) {
      const notifier = new NotificationService(req.app.get('io'));
      const label = task.parentId ? 'Subtask' : 'Task';
      await notifier.send({
        userId: task.project.managerId,
        title: `${label} Completed`,
        body: `"${task.title}" completed by ${task.assignedTo?.name}`,
        type: 'TASK_UPDATED',
        entityType: 'task',
        entityId: task.id,
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

// DELETE /api/tasks/:id — also deletes all subtasks (cascade should handle this in schema)
router.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    // Delete subtasks first if no cascade
    await prisma.task.deleteMany({ where: { parentId: req.params.id } });
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ message: 'Task deleted' });
  } catch (error) { next(error); }
});

module.exports = router;