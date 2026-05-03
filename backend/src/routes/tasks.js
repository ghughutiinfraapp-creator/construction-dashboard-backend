const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

// Valid TaskStatus values matching the Prisma enum
const DONE_STATUSES = ['COMPLETED', 'VERIFIED'];

// GET /api/tasks
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { projectId, status, assignedToId, page = 1, limit = 20 } = req.query;

    const where = { parentId: null }; // top-level tasks only
    if (projectId)    where.projectId    = projectId;
    if (status)       where.status       = status;
    if (assignedToId) where.assignedToId = assignedToId;
    if (req.user.role === 'SITE_ENGINEER') where.assignedToId = req.user.id;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        include: {
          project:    { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true, avatar: true } },
          createdBy:  { select: { id: true, name: true } },
          subtasks: {
            include: { assignedTo: { select: { id: true, name: true, avatar: true } } },
            orderBy: { createdAt: 'asc' },
          },
          _count: { select: { photos: true } },
        },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
      }),
      prisma.task.count({ where }),
    ]);

    // Always return subtasks array so the frontend never crashes
    const normalised = tasks.map(t => ({ ...t, subtasks: t.subtasks ?? [] }));

    res.json({ tasks: normalised, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// POST /api/tasks
router.post('/', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { projectId, title, description, assignedToId, priority, startDate, dueDate } = req.body;
    const task = await prisma.task.create({
      data: {
        projectId, title, description, assignedToId,
        priority:   priority   || 'MEDIUM',
        createdById: req.user.id,
        startDate:  startDate  ? new Date(startDate) : null,
        dueDate:    dueDate    ? new Date(dueDate)   : null,
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
        project:    { select: { id: true, name: true } },
      },
    });

    if (assignedToId) {
      try {
        const notifier = new NotificationService(req.app.get('io'));
        await notifier.send({
          userId: assignedToId, title: 'New Task Assigned',
          body: `You have been assigned: "${title}" in ${task.project.name}`,
          type: 'TASK_ASSIGNED', entityType: 'task', entityId: task.id,
        });
      } catch (_) {}
    }

    res.status(201).json({ task: { ...task, subtasks: [] } });
  } catch (error) { next(error); }
});

// ── SUBTASK ROUTES — must come BEFORE generic /:id routes ─────────────────

// POST /api/tasks/:id/subtasks
router.post('/:id/subtasks', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const parent = await prisma.task.findUnique({
      where: { id: req.params.id },
      select: { id: true, projectId: true, project: { select: { name: true } } },
    });
    if (!parent) return res.status(404).json({ error: 'Parent task not found' });

    const { title, description, assignedToId, priority, startDate, dueDate } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

    const subtask = await prisma.task.create({
      data: {
        projectId:   parent.projectId,
        parentId:    parent.id,
        title:       title.trim(),
        description: description?.trim() || null,
        assignedToId: assignedToId || null,
        priority:    priority || 'MEDIUM',
        createdById: req.user.id,
        startDate:   startDate ? new Date(startDate) : null,
        dueDate:     dueDate   ? new Date(dueDate)   : null,
      },
      include: { assignedTo: { select: { id: true, name: true, avatar: true } } },
    });

    if (assignedToId) {
      try {
        const notifier = new NotificationService(req.app.get('io'));
        await notifier.send({
          userId: assignedToId, title: 'New Subtask Assigned',
          body: `You have been assigned a subtask: "${title}" in ${parent.project.name}`,
          type: 'TASK_ASSIGNED', entityType: 'task', entityId: subtask.id,
        });
      } catch (_) {}
    }

    res.status(201).json({ subtask });
  } catch (error) {
    console.error('Create subtask error:', error);
    next(error);
  }
});

// GET /api/tasks/:id/subtasks
router.get('/:id/subtasks', authenticate, async (req, res, next) => {
  try {
    const subtasks = await prisma.task.findMany({
      where: { parentId: req.params.id },
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
        createdBy:  { select: { id: true, name: true } },
        _count: { select: { photos: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ subtasks });
  } catch (error) { next(error); }
});

// PUT /api/tasks/:id/status
router.put('/:id/status', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const data = { status };
    if (DONE_STATUSES.includes(status)) data.completedAt = new Date();
    else data.completedAt = null; // clear if moving back from done

    const task = await prisma.task.update({
      where: { id: req.params.id }, data,
      include: {
        project:    { select: { id: true, name: true, managerId: true } },
        assignedTo: { select: { name: true } },
      },
    });

    // Roll up parent status when a subtask changes
    if (task.parentId) {
      try {
        const siblings = await prisma.task.findMany({
          where:  { parentId: task.parentId },
          select: { status: true },
        });
        const allDone    = siblings.every(s => DONE_STATUSES.includes(s.status));
        const anyBlocked = siblings.some(s => s.status === 'BLOCKED');
        const anyActive  = siblings.some(s => s.status === 'IN_PROGRESS');

        let parentStatus = 'NOT_STARTED';
        if (allDone)      parentStatus = 'COMPLETED';
        else if (anyBlocked) parentStatus = 'BLOCKED';
        else if (anyActive)  parentStatus = 'IN_PROGRESS';

        await prisma.task.update({
          where: { id: task.parentId },
          data:  { status: parentStatus, completedAt: allDone ? new Date() : null },
        });
      } catch (_) {}
    }

    // Notify PM on completion
    if (DONE_STATUSES.includes(status) && task.project?.managerId) {
      try {
        const notifier = new NotificationService(req.app.get('io'));
        await notifier.send({
          userId: task.project.managerId,
          title:  task.parentId ? 'Subtask Completed' : 'Task Completed',
          body:   `"${task.title}" completed by ${task.assignedTo?.name ?? 'someone'}`,
          type: 'TASK_UPDATED', entityType: 'task', entityId: task.id,
        });
      } catch (_) {}
    }

    res.json({ task });
  } catch (error) { next(error); }
});

// PUT /api/tasks/:id  (generic update — must come AFTER specific sub-routes)
router.put('/:id', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const task = await prisma.task.update({ where: { id: req.params.id }, data: req.body });
    res.json({ task });
  } catch (error) { next(error); }
});

// DELETE /api/tasks/:id
router.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    // Subtasks are cascade-deleted by the DB (onDelete: Cascade on parentId)
    // but deleteMany is a safe fallback
    await prisma.task.deleteMany({ where: { parentId: req.params.id } });
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ message: 'Task deleted' });
  } catch (error) { next(error); }
});

module.exports = router;