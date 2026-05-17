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
          category:   { select: { id: true, name: true } },
          subtasks: {
            include: {
              assignedTo: { select: { id: true, name: true, avatar: true } },
              category:   { select: { id: true, name: true } },
            },
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

// Resolves a subtask title from its categoryId if no title was provided
async function resolveTitle(title, categoryId) {
  if (title?.trim()) return title.trim();
  if (!categoryId) return null;
  const cat = await prisma.taskCategory.findUnique({ where: { id: categoryId }, select: { name: true } });
  return cat?.name ?? null;
}

// POST /api/tasks
// Creates a top-level task or a subtask depending on whether parentId is supplied.
// Pass a `subtasks` array to create the parent and all its subtasks in one call.
router.post('/', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { description, assignedToId, priority, startDate, dueDate, categoryId, parentId, subtasks = [] } = req.body;
    let { title, projectId } = req.body;

    // Resolve parent when creating a subtask
    let projectName = null;
    if (parentId) {
      const parent = await prisma.task.findUnique({
        where: { id: parentId },
        select: { projectId: true, project: { select: { name: true } } },
      });
      if (!parent) return res.status(404).json({ error: 'Parent task not found' });
      projectId   = parent.projectId;
      projectName = parent.project.name;
    }

    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    // Auto-fill title from category name when no custom title provided
    title = await resolveTitle(title, categoryId);
    if (!title) return res.status(400).json({ error: 'title is required' });

    // Create parent task
    const task = await prisma.task.create({
      data: {
        projectId,
        parentId:     parentId     || null,
        title,
        description:  description  || null,
        assignedToId: assignedToId || null,
        priority:     priority     || 'MEDIUM',
        createdById:  req.user.id,
        startDate:    startDate    ? new Date(startDate) : null,
        dueDate:      dueDate      ? new Date(dueDate)   : null,
        categoryId:   categoryId   || null,
      },
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
        project:    { select: { id: true, name: true } },
        category:   { select: { id: true, name: true } },
      },
    });

    projectName = projectName ?? task.project.name;

    // Notify assignee on the parent task
    if (assignedToId) {
      try {
        const notifier = new NotificationService(req.app.get('io'));
        await notifier.send({
          userId: assignedToId,
          title:  parentId ? 'New Subtask Assigned' : 'New Task Assigned',
          body:   `You have been assigned: "${task.title}" in ${projectName}`,
          type: 'TASK_ASSIGNED', entityType: 'task', entityId: task.id,
        });
      } catch (_) {}
    }

    // Create subtasks if provided in the same request
    let createdSubtasks = [];
    if (subtasks.length > 0) {
      const resolved = await Promise.all(
        subtasks.map(async (sub) => ({
          ...sub,
          title: await resolveTitle(sub.title, sub.categoryId),
        }))
      );

      const invalid = resolved.find(s => !s.title);
      if (invalid) return res.status(400).json({ error: 'Each subtask must have a title or a valid categoryId' });

      createdSubtasks = await Promise.all(
        resolved.map(sub =>
          prisma.task.create({
            data: {
              projectId,
              parentId:     task.id,
              title:        sub.title,
              description:  sub.description  || null,
              assignedToId: sub.assignedToId || null,
              priority:     sub.priority     || 'MEDIUM',
              createdById:  req.user.id,
              startDate:    sub.startDate    ? new Date(sub.startDate) : null,
              dueDate:      sub.dueDate      ? new Date(sub.dueDate)   : null,
              categoryId:   sub.categoryId   || null,
            },
            include: {
              assignedTo: { select: { id: true, name: true, avatar: true } },
              category:   { select: { id: true, name: true } },
            },
          })
        )
      );

      // Notify subtask assignees
      const notifier = new NotificationService(req.app.get('io'));
      for (const sub of createdSubtasks) {
        if (sub.assignedToId) {
          try {
            await notifier.send({
              userId: sub.assignedToId,
              title:  'New Subtask Assigned',
              body:   `You have been assigned: "${sub.title}" in ${projectName}`,
              type: 'TASK_ASSIGNED', entityType: 'task', entityId: sub.id,
            });
          } catch (_) {}
        }
      }
    }

    res.status(201).json({ task: { ...task, subtasks: createdSubtasks } });
  } catch (error) { next(error); }
});

// ── SUBTASK ROUTES — must come BEFORE generic /:id routes ─────────────────

// GET /api/tasks/:id/subtasks
router.get('/:id/subtasks', authenticate, async (req, res, next) => {
  try {
    const subtasks = await prisma.task.findMany({
      where: { parentId: req.params.id },
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
        createdBy:  { select: { id: true, name: true } },
        category:   { select: { id: true, name: true } },
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
    const { title, description, assignedToId, priority, startDate, dueDate, categoryId } = req.body;
    const data = {};
    if (title        !== undefined) data.title        = title;
    if (description  !== undefined) data.description  = description;
    if (assignedToId !== undefined) data.assignedToId = assignedToId;
    if (priority     !== undefined) data.priority     = priority;
    if (startDate    !== undefined) data.startDate    = startDate ? new Date(startDate) : null;
    if (dueDate      !== undefined) data.dueDate      = dueDate   ? new Date(dueDate)   : null;
    if (categoryId   !== undefined) data.categoryId   = categoryId || null;

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data,
      include: {
        project:    { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true, avatar: true } },
        category:   { select: { id: true, name: true } },
      },
    });
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