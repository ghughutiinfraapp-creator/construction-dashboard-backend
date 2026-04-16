const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/projects
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    let where = {};

    // Role-based filtering
    if (req.user.role === 'CLIENT') where.clientId = req.user.id;
    else if (req.user.role === 'SITE_ENGINEER') where.tasks = { some: { assignedToId: req.user.id } };
    else if (req.user.role === 'PROJECT_MANAGER') where.managerId = req.user.id;
    else if (req.user.role === 'FOREMAN') where.foremanId = req.user.id;
    if (status) where.status = status;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [projects, total] = await Promise.all([ 
      prisma.project.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        include: {
          manager: { select: { id: true, name: true, avatar: true } },
          client: { select: { id: true, name: true } },
          foreman: { select: { id: true, name: true, avatar: true } },
          _count: { select: { tasks: true, purchaseOrders: true, attendance: true } }
        },
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.project.count({ where })
    ]);
    res.json({ projects, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// POST /api/projects
router.post('/', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { name, description, address, clientId, budget, startDate, endDate, geofenceLat, geofenceLng, geofenceRadius } = req.body;
    const project = await prisma.project.create({
      data: {
        name, description, address, managerId: req.user.id, clientId,
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
        _count: { select: { tasks: true, purchaseOrders: true, labourers: true, attendance: true } }
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

module.exports = router;
