const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { isWithinGeofence } = require('../utils/geofence');
const NotificationService = require('../services/notificationService');

// POST /api/attendance/punch-in
router.post('/punch-in', authenticate, authorize('SITE_ENGINEER', 'JUNIOR_ENGINEER'), async (req, res, next) => {
  try {
    const { projectId, lat, lng, selfieUrl } = req.body;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Block if there is already an open (not punched out) session
    const activeSession = await prisma.attendance.findFirst({
      where: { userId: req.user.id, date: today, punchOutTime: null }
    });
    if (activeSession) return res.status(400).json({ error: 'Please punch out from current site before punching in to another' });

    // Get project geo-fence
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, managerId: true, clientId: true, geofenceLat: true, geofenceLng: true, geofenceRadius: true }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.geofenceLat || !project.geofenceLng) return res.status(400).json({ error: 'Geo-fence not set for this project' });

    // Validate geo-fence
    const { isInside, distance } = isWithinGeofence(lat, lng, project.geofenceLat, project.geofenceLng, project.geofenceRadius);
    if (!isInside) {
      return res.status(403).json({
        error: 'You are not at the site location',
        distance: Math.round(distance),
        requiredRadius: project.geofenceRadius
      });
    }

    const attendance = await prisma.attendance.create({
      data: {
        userId: req.user.id, projectId, date: today,
        punchInTime: new Date(), punchInLat: lat, punchInLng: lng,
        selfieUrl, isWithinGeofence: true
      }
    });

    // Emit real-time update
    const io = req.app.get('io');
    if (io) io.to(`project-${projectId}`).emit('attendance-update', { type: 'punch-in', userId: req.user.id, attendance });

    // Notify client and project manager with role-specific messages
    const notifier = new NotificationService(io);
    if (project.managerId) {
      await notifier.send({
        userId: project.managerId,
        title: 'Engineer Punched In',
        body: `${req.user.name} has punched in at ${project.name}`,
        type: 'GENERAL',
        entityType: 'attendance',
        entityId: attendance.id
      });
    }
    if (project.clientId) {
      const roleLabel = req.user.role === 'JUNIOR_ENGINEER' ? 'Junior Engineer' : 'Site Engineer';
      await notifier.send({
        userId: project.clientId,
        title: `${roleLabel} Available`,
        body: `${roleLabel} is available on the site. Please connect if required.`,
        type: 'GENERAL',
        entityType: 'attendance',
        entityId: attendance.id
      });
    }

    res.status(201).json({ message: 'Punched in successfully', attendance });
  } catch (error) { next(error); }
});

// POST /api/attendance/punch-out
router.post('/punch-out', authenticate, authorize('SITE_ENGINEER', 'JUNIOR_ENGINEER'), async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const attendance = await prisma.attendance.findFirst({
      where: { userId: req.user.id, date: today, punchOutTime: null }
    });
    if (!attendance) return res.status(400).json({ error: 'No active punch-in found for today' });

    const punchOutTime = new Date();
    const totalHours = (punchOutTime - attendance.punchInTime) / (1000 * 60 * 60);

    const updated = await prisma.attendance.update({
      where: { id: attendance.id },
      data: { punchOutTime, punchOutLat: lat, punchOutLng: lng, totalHours: Math.round(totalHours * 100) / 100 }
    });

    const io = req.app.get('io');
    if (io) io.to(`project-${attendance.projectId}`).emit('attendance-update', { type: 'punch-out', userId: req.user.id, attendance: updated });

    res.json({ message: 'Punched out successfully', attendance: updated });
  } catch (error) { next(error); }
});

// GET /api/attendance/today
router.get('/today', authenticate, async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const where = { date: today };
    if (['SITE_ENGINEER', 'JUNIOR_ENGINEER'].includes(req.user.role)) where.userId = req.user.id;
    if (req.query.projectId) where.projectId = req.query.projectId;

    const records = await prisma.attendance.findMany({
      where,
      include: { user: { select: { id: true, name: true, avatar: true } }, project: { select: { id: true, name: true } } },
      orderBy: { punchInTime: 'desc' }
    });
    res.json({ attendance: records });
  } catch (error) { next(error); }
});

// GET /api/attendance/history
router.get('/history', authenticate, async (req, res, next) => {
  try {
    const { projectId, userId, startDate, endDate, page = 1, limit = 30 } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (userId) where.userId = userId;
    if (['SITE_ENGINEER', 'JUNIOR_ENGINEER'].includes(req.user.role)) where.userId = req.user.id;
    if (startDate && endDate) where.date = { gte: new Date(startDate), lte: new Date(endDate) };

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        include: { user: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
        orderBy: { date: 'desc' }
      }),
      prisma.attendance.count({ where })
    ]);
    res.json({ attendance: records, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// GET /api/attendance/status (check current punch status)
router.get('/status', authenticate, authorize('SITE_ENGINEER', 'JUNIOR_ENGINEER'), async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const records = await prisma.attendance.findMany({
      where: { userId: req.user.id, date: today },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { punchInTime: 'asc' }
    });
    const activeRecord = records.find(r => !r.punchOutTime) ?? null;
    res.json({
      isPunchedIn: !!activeRecord,
      activeRecord,
      sessions: records
    });
  } catch (error) { next(error); }
});

module.exports = router;
