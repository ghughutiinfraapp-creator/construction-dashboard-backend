const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/labour/labourers
router.get('/labourers', authenticate, async (req, res, next) => {
  try {
    const { projectId, tradeType, search } = req.query;
    const where = { isActive: true };
    if (projectId) where.projectId = projectId;
    if (tradeType) where.tradeType = tradeType;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const labourers = await prisma.labourer.findMany({
      where, include: { project: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' }
    });
    res.json({ labourers });
  } catch (error) { next(error); }
});

// POST /api/labour/labourers
router.post('/labourers', authenticate, authorize('SITE_ENGINEER', 'PROJECT_MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { name, phone, aadhaar, tradeType, dailyWage, projectId } = req.body;
    const labourer = await prisma.labourer.create({
      data: { name, phone, aadhaar, tradeType, dailyWage: parseFloat(dailyWage), projectId }
    });
    res.status(201).json({ labourer });
  } catch (error) { next(error); }
});

// POST /api/labour/attendance/mark
router.post('/attendance/mark', authenticate, authorize('SITE_ENGINEER'), async (req, res, next) => {
  try {
    const { projectId, date, records } = req.body;
    // records: [{ labourerId, status, photoUrl }]
    const attendanceDate = new Date(date); attendanceDate.setHours(0, 0, 0, 0);

    const results = await Promise.all(
      records.map(async (record) => {
        return prisma.labourAttendance.upsert({
          where: { labourerId_date: { labourerId: record.labourerId, date: attendanceDate } },
          update: { status: record.status, photoUrl: record.photoUrl },
          create: {
            labourerId: record.labourerId, projectId,
            markedById: req.user.id, date: attendanceDate,
            status: record.status, photoUrl: record.photoUrl
          }
        });
      })
    );

    res.json({ message: `Marked attendance for ${results.length} labourers`, records: results });
  } catch (error) { next(error); }
});

// GET /api/labour/attendance
router.get('/attendance', authenticate, async (req, res, next) => {
  try {
    const { projectId, date, startDate, endDate } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (date) { const d = new Date(date); d.setHours(0,0,0,0); where.date = d; }
    if (startDate && endDate) where.date = { gte: new Date(startDate), lte: new Date(endDate) };

    const records = await prisma.labourAttendance.findMany({
      where,
      include: {
        labourer: { select: { id: true, name: true, tradeType: true, dailyWage: true } },
        markedBy: { select: { id: true, name: true } }
      },
      orderBy: { date: 'desc' }
    });
    res.json({ attendance: records });
  } catch (error) { next(error); }
});

// GET /api/labour/wage-report
router.get('/wage-report', authenticate, async (req, res, next) => {
  try {
    const { projectId, startDate, endDate } = req.query;
    const where = { status: 'PRESENT' };
    if (projectId) where.projectId = projectId;
    if (startDate && endDate) where.date = { gte: new Date(startDate), lte: new Date(endDate) };

    const records = await prisma.labourAttendance.findMany({
      where: { ...where, OR: [{ status: 'PRESENT' }, { status: 'HALF_DAY' }] },
      include: { labourer: { select: { id: true, name: true, tradeType: true, dailyWage: true } } }
    });

    // Calculate wages
    const wageMap = {};
    records.forEach(r => {
      if (!wageMap[r.labourerId]) {
        wageMap[r.labourerId] = { ...r.labourer, daysPresent: 0, halfDays: 0, totalWage: 0 };
      }
      if (r.status === 'PRESENT') { wageMap[r.labourerId].daysPresent++; wageMap[r.labourerId].totalWage += parseFloat(r.labourer.dailyWage); }
      if (r.status === 'HALF_DAY') { wageMap[r.labourerId].halfDays++; wageMap[r.labourerId].totalWage += parseFloat(r.labourer.dailyWage) / 2; }
    });

    res.json({ report: Object.values(wageMap), totalLabourCost: Object.values(wageMap).reduce((s, w) => s + w.totalWage, 0) });
  } catch (error) { next(error); }
});

module.exports = router;
