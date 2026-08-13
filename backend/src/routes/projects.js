const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/projects
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    let where = {};

    // Role-based filtering
    // NOTE: SITE_ENGINEER is intentionally NOT filtered to assigned-only
    // projects — engineers can see & punch into ANY site (we still flag
    // which ones are "theirs" so those sort to the top). FOREMAN has no
    // assignment concept at all: every foreman simply sees every project.
    if (req.user.role === 'CLIENT') where.clientId = req.user.id;
    else if (req.user.role === 'PROJECT_MANAGER') where.managerId = req.user.id;
    if (status) where.status = status;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        include: {
          manager: { select: { id: true, name: true, avatar: true } },
          client: { select: { id: true, name: true } },
          foreman: { select: { id: true, name: true, avatar: true } },
          _count: { select: { tasks: true, purchaseOrders: true, attendance: true } },
          // For engineers, pull just enough to know if THEY have a task here
          ...(req.user.role === 'SITE_ENGINEER'
            ? { tasks: { where: { assignedToId: req.user.id }, select: { id: true }, take: 1 } }
            : {}),
        },
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.project.count({ where })
    ]);

    let result = projects;

    if (req.user.role === 'SITE_ENGINEER') {
      // Mark assigned sites, then move them to the top (stable sort keeps
      // the original updatedAt ordering within each group).
      result = projects
        .map(({ tasks, ...p }) => ({ ...p, isAssigned: Array.isArray(tasks) && tasks.length > 0 }))
        .sort((a, b) => Number(b.isAssigned) - Number(a.isAssigned));
    }
    // FOREMAN: no filtering, no flagging — `result` stays as the plain
    // `projects` list, every foreman just sees every project.

    res.json({ projects: result, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// POST /api/projects
router.post('/', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { name, description, address, clientId, managerId, budget, startDate, endDate, geofenceLat, geofenceLng, geofenceRadius } = req.body;
    const project = await prisma.project.create({
      data: {
        name, description, address,
        managerId: managerId || req.user.id, // allow override, default to creator
        clientId,
        budget: budget ? parseFloat(budget) : null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        geofenceLat: geofenceLat ? parseFloat(geofenceLat) : null,
        geofenceLng: geofenceLng ? parseFloat(geofenceLng) : null,
        geofenceRadius: geofenceRadius ? parseInt(geofenceRadius) : 300,
        status: 'ACTIVE'
      },
      include: { manager: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } }
    });
    res.status(201).json({ project });
  } catch (error) { next(error); }
});

// GET /api/projects/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        manager: { select: { id: true, name: true, email: true, avatar: true } },
        client: { select: { id: true, name: true, email: true } },
        foreman: { select: { id: true, name: true, email: true, avatar: true } },
        _count: { select: { tasks: true, purchaseOrders: true, subContractors: true, attendance: true } }
      }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
  } catch (error) { next(error); }
});

// PUT /api/projects/:id
router.put('/:id', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (data.budget) data.budget = parseFloat(data.budget);
    if (data.geofenceLat) data.geofenceLat = parseFloat(data.geofenceLat);
    if (data.geofenceLng) data.geofenceLng = parseFloat(data.geofenceLng);
    if (data.geofenceRadius) data.geofenceRadius = parseInt(data.geofenceRadius);
    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);

    const project = await prisma.project.update({ where: { id: req.params.id }, data });
    res.json({ project });
  } catch (error) { next(error); }
});

// PUT /api/projects/:id/assign-foreman
router.put('/:id/assign-foreman', authenticate, authorize('PROJECT_MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { foremanId } = req.body;

    if (foremanId) {
      const foreman = await prisma.user.findUnique({ where: { id: foremanId }, select: { id: true, role: true } });
      if (!foreman || foreman.role !== 'FOREMAN') return res.status(400).json({ error: 'User is not a foreman' });
    }

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { foremanId: foremanId || null },
      include: {
        manager: { select: { id: true, name: true } },
        foreman: { select: { id: true, name: true } }
      }
    });
    res.json({ project, message: foremanId ? 'Foreman assigned successfully' : 'Foreman removed successfully' });
  } catch (error) { next(error); }
});

// PUT /api/projects/:id/geofence
router.put('/:id/geofence', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { geofenceLat, geofenceLng, geofenceRadius } = req.body;
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { geofenceLat: parseFloat(geofenceLat), geofenceLng: parseFloat(geofenceLng), geofenceRadius: parseInt(geofenceRadius) }
    });
    res.json({ project, message: 'Geo-fence updated successfully' });
  } catch (error) { next(error); }
});

// GET /api/projects/:id/photos
router.get('/:id/photos', authenticate, async (req, res, next) => {
  try {
    const where = { projectId: req.params.id };
    if (req.query.entityType) where.entityType = req.query.entityType;

    const photos = await prisma.photo.findMany({
      where,
      include: {
        uploadedBy: { select: { id: true, name: true } },
        task:       { select: { id: true, title: true } },
      },
      orderBy: { capturedAt: 'desc' }
    });

    res.json({ photos });
  } catch (error) { next(error); }
});

module.exports = router;