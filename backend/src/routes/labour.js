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
router.post('/labourers', authenticate, authorize('SITE_ENGINEER', 'PROJECT_MANAGER', 'SUPER_ADMIN','FOREMAN'), async (req, res, next) => {
  try {
    const { name, phone, aadhaar, tradeType, proposedAmount, amountPaid, projectId } = req.body;
    if (!name || !tradeType || !projectId) return res.status(400).json({ error: 'name, tradeType and projectId are required' });

    const parsedProposedAmount = parseFloat(proposedAmount);
    if (isNaN(parsedProposedAmount)) return res.status(400).json({ error: 'proposedAmount must be a valid number' });

    const parsedAmountPaid = amountPaid !== undefined ? parseFloat(amountPaid) : 0;
    if (isNaN(parsedAmountPaid)) return res.status(400).json({ error: 'amountPaid must be a valid number' });

    const labourer = await prisma.labourer.create({
      data: {
        name, phone, aadhaar, tradeType, projectId,
        proposedAmount: parsedProposedAmount,
        amountPaid: parsedAmountPaid
      }
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
        labourer: { select: { id: true, name: true, tradeType: true, proposedAmount: true, amountPaid: true } },
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
    const where = {};
    if (projectId) {
      where.projectId = projectId;
      where.labourer = { projectId };
    }
    if (startDate && endDate) where.date = { gte: new Date(startDate), lte: new Date(endDate) };

    const records = await prisma.labourAttendance.findMany({
      where: { ...where, OR: [{ status: 'PRESENT' }, { status: 'HALF_DAY' }] },
      include: { labourer: { select: { id: true, name: true, tradeType: true, proposedAmount: true, amountPaid: true } } }
    });

    // Calculate attendance summary per labourer
    const wageMap = {};
    records.forEach(r => {
      if (!wageMap[r.labourerId]) {
        const proposedAmount = parseFloat(r.labourer.proposedAmount);
        const amountPaid = parseFloat(r.labourer.amountPaid);
        wageMap[r.labourerId] = {
          ...r.labourer,
          proposedAmount, amountPaid,
          pendingAmount: proposedAmount - amountPaid,
          daysPresent: 0, halfDays: 0
        };
      }
      if (r.status === 'PRESENT') wageMap[r.labourerId].daysPresent++;
      if (r.status === 'HALF_DAY') wageMap[r.labourerId].halfDays++;
    });

    res.json({ report: Object.values(wageMap) });
  } catch (error) { next(error); }
});
router.post('/sites/:id/labour', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const siteId = req.params.id;
    const { labourCount, pricePerLabour, date, notes, workerIds } = req.body;

    const count = parseInt(labourCount);
    if (!Array.isArray(workerIds) || workerIds.length !== count) {
      return res.status(400).json({
        message: `Expected ${count} worker id(s) but received ${workerIds?.length ?? 0}.`,
      });
    }

    const totalCost = count * parseFloat(pricePerLabour);

    const entry = await prisma.labourEntry.create({
      data: {
        projectId: siteId,
        labourCount: count,
        pricePerLabour: parseFloat(pricePerLabour),
        totalCost,
        date: new Date(date),
        notes: notes || null,
        createdById: req.user.id,
        workers: {
          create: workerIds.map((labourerId) => ({ labourerId })),
        },
      },
      include: {
        workers: { include: { labourer: true } },
        createdBy: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    // Flatten workers -> the shape the frontend LabourEntry.workers expects
    res.status(201).json({
      entry: {
        ...entry,
        workers: entry.workers.map((w) => ({
          id: w.labourer.id,
          name: w.labourer.name,
          tradeType: w.labourer.tradeType,
          phone: w.labourer.phone,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/labour/labourers/:id
router.put('/labourers/:id', authenticate, authorize('SUPER_ADMIN', 'FOREMAN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { proposedAmount } = req.body;

    const data = {};
    if (proposedAmount !== undefined) {
      const p = parseFloat(proposedAmount);
      if (isNaN(p)) return res.status(400).json({ error: 'proposedAmount must be a valid number' });
      data.proposedAmount = p;
    }

    const labourer = await prisma.labourer.update({ where: { id }, data });
    res.json({ labourer });
  } catch (error) { next(error); }
});

// POST /api/labour/labourers/:id/payments
router.post('/labourers/:id/payments', authenticate, authorize('SUPER_ADMIN', 'FOREMAN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, paymentDate, paymentMode, receiptNumber, notes } = req.body;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const [payment] = await prisma.$transaction([
      prisma.labourPayment.create({
        data: {
          labourerId: id,
          amount: parsedAmount,
          paymentDate: paymentDate ? new Date(paymentDate) : undefined,
          paymentMode,
          receiptNumber,
          notes,
          recordedById: req.user.id
        }
      }),
      prisma.labourer.update({
        where: { id },
        data: { amountPaid: { increment: parsedAmount } }
      })
    ]);

    res.status(201).json({ payment });
  } catch (error) { next(error); }
});

// GET /api/labour/labourers/:id/payments
router.get('/labourers/:id/payments', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const payments = await prisma.labourPayment.findMany({
      where: { labourerId: id },
      include: { recordedBy: { select: { id: true, name: true } } },
      orderBy: { paymentDate: 'desc' }
    });
    res.json({ payments });
  } catch (error) { next(error); }
});

module.exports = router;
