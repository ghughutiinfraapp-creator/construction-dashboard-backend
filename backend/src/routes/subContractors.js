const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/sub-contractors
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { projectId, tradeType, search } = req.query;
    const where = { isActive: true };
    if (projectId) where.projectId = projectId;
    if (tradeType) where.tradeType = tradeType;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const subContractors = await prisma.subContractor.findMany({
      where, include: { project: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' }
    });
    res.json({ subContractors });
  } catch (error) { next(error); }
});

// POST /api/sub-contractors
router.post('/', authenticate, authorize('SITE_ENGINEER', 'PROJECT_MANAGER', 'SUPER_ADMIN','FOREMAN'), async (req, res, next) => {
  try {
    const { name, phone, aadhaar, tradeType, proposedAmount, amountPaid, projectId } = req.body;
    if (!name || !tradeType || !projectId) return res.status(400).json({ error: 'name, tradeType and projectId are required' });

    const parsedProposedAmount = parseFloat(proposedAmount);
    if (isNaN(parsedProposedAmount)) return res.status(400).json({ error: 'proposedAmount must be a valid number' });

    const parsedAmountPaid = amountPaid !== undefined ? parseFloat(amountPaid) : 0;
    if (isNaN(parsedAmountPaid)) return res.status(400).json({ error: 'amountPaid must be a valid number' });

    const subContractor = await prisma.subContractor.create({
      data: {
        name, phone, aadhaar, tradeType, projectId,
        proposedAmount: parsedProposedAmount,
        amountPaid: parsedAmountPaid
      }
    });
    res.status(201).json({ subContractor });
  } catch (error) { next(error); }
});

// POST /api/sub-contractors/attendance/mark
router.post('/attendance/mark', authenticate, authorize('SITE_ENGINEER'), async (req, res, next) => {
  try {
    const { projectId, date, records } = req.body;
    // records: [{ subContractorId, status, photoUrl }]
    const attendanceDate = new Date(date); attendanceDate.setHours(0, 0, 0, 0);

    const results = await Promise.all(
      records.map(async (record) => {
        return prisma.subContractorAttendance.upsert({
          where: { subContractorId_date: { subContractorId: record.subContractorId, date: attendanceDate } },
          update: { status: record.status, photoUrl: record.photoUrl },
          create: {
            subContractorId: record.subContractorId, projectId,
            markedById: req.user.id, date: attendanceDate,
            status: record.status, photoUrl: record.photoUrl
          }
        });
      })
    );

    res.json({ message: `Marked attendance for ${results.length} sub-contractors`, records: results });
  } catch (error) { next(error); }
});

// GET /api/sub-contractors/attendance
router.get('/attendance', authenticate, async (req, res, next) => {
  try {
    const { projectId, date, startDate, endDate } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (date) { const d = new Date(date); d.setHours(0,0,0,0); where.date = d; }
    if (startDate && endDate) where.date = { gte: new Date(startDate), lte: new Date(endDate) };

    const records = await prisma.subContractorAttendance.findMany({
      where,
      include: {
        subContractor: { select: { id: true, name: true, tradeType: true, proposedAmount: true, amountPaid: true } },
        markedBy: { select: { id: true, name: true } }
      },
      orderBy: { date: 'desc' }
    });
    res.json({ attendance: records });
  } catch (error) { next(error); }
});

// GET /api/sub-contractors/wage-report
router.get('/wage-report', authenticate, async (req, res, next) => {
  try {
    const { projectId, startDate, endDate } = req.query;
    const where = {};
    if (projectId) {
      where.projectId = projectId;
      where.subContractor = { projectId };
    }
    if (startDate && endDate) where.date = { gte: new Date(startDate), lte: new Date(endDate) };

    const records = await prisma.subContractorAttendance.findMany({
      where: { ...where, OR: [{ status: 'PRESENT' }, { status: 'HALF_DAY' }] },
      include: { subContractor: { select: { id: true, name: true, tradeType: true, proposedAmount: true, amountPaid: true } } }
    });

    // Calculate attendance summary per sub-contractor
    const wageMap = {};
    records.forEach(r => {
      if (!wageMap[r.subContractorId]) {
        const proposedAmount = parseFloat(r.subContractor.proposedAmount);
        const amountPaid = parseFloat(r.subContractor.amountPaid);
        wageMap[r.subContractorId] = {
          ...r.subContractor,
          proposedAmount, amountPaid,
          pendingAmount: proposedAmount - amountPaid,
          daysPresent: 0, halfDays: 0
        };
      }
      if (r.status === 'PRESENT') wageMap[r.subContractorId].daysPresent++;
      if (r.status === 'HALF_DAY') wageMap[r.subContractorId].halfDays++;
    });

    res.json({ report: Object.values(wageMap) });
  } catch (error) { next(error); }
});

// PUT /api/sub-contractors/:id
router.put('/:id', authenticate, authorize('SUPER_ADMIN', 'FOREMAN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { proposedAmount } = req.body;

    const data = {};
    if (proposedAmount !== undefined) {
      const p = parseFloat(proposedAmount);
      if (isNaN(p)) return res.status(400).json({ error: 'proposedAmount must be a valid number' });
      data.proposedAmount = p;
    }

    const subContractor = await prisma.subContractor.update({ where: { id }, data });
    res.json({ subContractor });
  } catch (error) { next(error); }
});

// POST /api/sub-contractors/:id/payments
router.post('/:id/payments', authenticate, authorize('SUPER_ADMIN', 'FOREMAN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, paymentDate, paymentMode, receiptNumber, notes } = req.body;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const [payment] = await prisma.$transaction([
      prisma.subContractorPayment.create({
        data: {
          subContractorId: id,
          amount: parsedAmount,
          paymentDate: paymentDate ? new Date(paymentDate) : undefined,
          paymentMode,
          receiptNumber,
          notes,
          recordedById: req.user.id
        }
      }),
      prisma.subContractor.update({
        where: { id },
        data: { amountPaid: { increment: parsedAmount } }
      })
    ]);

    res.status(201).json({ payment });
  } catch (error) { next(error); }
});

// GET /api/sub-contractors/:id/payments
router.get('/:id/payments', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const payments = await prisma.subContractorPayment.findMany({
      where: { subContractorId: id },
      include: { recordedBy: { select: { id: true, name: true } } },
      orderBy: { paymentDate: 'desc' }
    });
    res.json({ payments });
  } catch (error) { next(error); }
});

module.exports = router;
