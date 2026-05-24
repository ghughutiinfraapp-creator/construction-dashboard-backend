const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

const inr = (n) => parseFloat(n).toLocaleString('en-IN');

// Lazily compute the effective status of an installment at read time.
// A PENDING/PARTIAL installment whose dueDate has passed is OVERDUE.
function effectiveStatus(inst) {
  if (inst.status === 'PAID') return 'PAID';
  if (inst.dueDate && new Date(inst.dueDate) < new Date()) return 'OVERDUE';
  return inst.status;
}

function enrichInstallments(installments) {
  return installments.map(i => ({ ...i, effectiveStatus: effectiveStatus(i) }));
}

// ─── CREATE SCHEDULE ─────────────────────────────────────────────────────────
// POST /api/payment-schedules
// Body: { projectId, totalAmount, notes?, installments: [{ title?, amount, dueDate?, notes? }] }
router.post('/', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { projectId, totalAmount, notes, installments = [] } = req.body;
    if (!projectId)    return res.status(400).json({ error: 'projectId is required' });
    if (!totalAmount)  return res.status(400).json({ error: 'totalAmount is required' });
    if (!installments.length) return res.status(400).json({ error: 'At least one installment is required' });

    const instSum = installments.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    if (Math.abs(instSum - parseFloat(totalAmount)) > 0.5) {
      return res.status(400).json({
        error: `Installment total ₹${inr(instSum)} does not match totalAmount ₹${inr(totalAmount)}`
      });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, managerId: true, clientId: true }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const schedule = await prisma.paymentSchedule.create({
      data: {
        projectId,
        totalAmount: parseFloat(totalAmount),
        notes: notes || null,
        createdById: req.user.id,
        installments: {
          create: installments.map((inst, idx) => ({
            installmentNo: idx + 1,
            title:   inst.title   || `Installment ${idx + 1}`,
            amount:  parseFloat(inst.amount),
            dueDate: inst.dueDate ? new Date(inst.dueDate) : null,
            notes:   inst.notes   || null,
          }))
        }
      },
      include: {
        project:      { select: { id: true, name: true } },
        createdBy:    { select: { id: true, name: true } },
        installments: { orderBy: { installmentNo: 'asc' } }
      }
    });

    const notifier = new NotificationService(req.app.get('io'));
    for (const uid of [project.managerId, project.clientId].filter(Boolean)) {
      try {
        await notifier.send({
          userId: uid, title: 'Payment Schedule Created',
          body: `Payment schedule of ₹${inr(totalAmount)} set for ${project.name} — ${installments.length} installment(s)`,
          type: 'PAYMENT_DUE', entityType: 'payment_schedule', entityId: schedule.id
        });
      } catch (_) {}
    }

    res.status(201).json({ schedule: { ...schedule, installments: enrichInstallments(schedule.installments) } });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A payment schedule already exists for this project' });
    next(error);
  }
});

// ─── LIST ─────────────────────────────────────────────────────────────────────
// GET /api/payment-schedules?projectId=X
router.get('/', authenticate, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.projectId) where.projectId = req.query.projectId;

    const schedules = await prisma.paymentSchedule.findMany({
      where,
      include: {
        project:   { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        installments: {
          orderBy: { installmentNo: 'asc' },
          include: { _count: { select: { payments: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const enriched = schedules.map(s => ({
      ...s,
      installments: enrichInstallments(s.installments)
    }));

    res.json({ schedules: enriched });
  } catch (error) { next(error); }
});

// ─── GET ONE ─────────────────────────────────────────────────────────────────
// GET /api/payment-schedules/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const schedule = await prisma.paymentSchedule.findUnique({
      where: { id: req.params.id },
      include: {
        project:   { select: { id: true, name: true, managerId: true, clientId: true } },
        createdBy: { select: { id: true, name: true } },
        installments: {
          orderBy: { installmentNo: 'asc' },
          include: {
            payments: {
              include: { recordedBy: { select: { id: true, name: true } } },
              orderBy: { paymentDate: 'desc' }
            }
          }
        }
      }
    });
    if (!schedule) return res.status(404).json({ error: 'Payment schedule not found' });

    res.json({ schedule: { ...schedule, installments: enrichInstallments(schedule.installments) } });
  } catch (error) { next(error); }
});

// ─── UPDATE SCHEDULE METADATA ─────────────────────────────────────────────────
// PUT /api/payment-schedules/:id
router.put('/:id', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { notes, totalAmount } = req.body;
    const data = {};
    if (notes       !== undefined) data.notes       = notes;
    if (totalAmount !== undefined) data.totalAmount = parseFloat(totalAmount);

    const schedule = await prisma.paymentSchedule.update({
      where: { id: req.params.id },
      data,
      include: { installments: { orderBy: { installmentNo: 'asc' } } }
    });
    res.json({ schedule: { ...schedule, installments: enrichInstallments(schedule.installments) } });
  } catch (error) { next(error); }
});

// ─── ADD INSTALLMENT ──────────────────────────────────────────────────────────
// POST /api/payment-schedules/:id/installments
router.post('/:id/installments', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { title, amount, dueDate, notes } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required' });

    const schedule = await prisma.paymentSchedule.findUnique({
      where: { id: req.params.id },
      select: { installments: { select: { installmentNo: true } } }
    });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    const nextNo = schedule.installments.length
      ? Math.max(...schedule.installments.map(i => i.installmentNo)) + 1
      : 1;

    const installment = await prisma.paymentInstallment.create({
      data: {
        scheduleId:    req.params.id,
        installmentNo: nextNo,
        title:   title   || `Installment ${nextNo}`,
        amount:  parseFloat(amount),
        dueDate: dueDate ? new Date(dueDate) : null,
        notes:   notes   || null,
      }
    });
    res.status(201).json({ installment: { ...installment, effectiveStatus: effectiveStatus(installment) } });
  } catch (error) { next(error); }
});

// ─── UPDATE INSTALLMENT ───────────────────────────────────────────────────────
// PUT /api/payment-schedules/:id/installments/:iid
router.put('/:id/installments/:iid', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { title, amount, dueDate, notes } = req.body;
    const data = {};
    if (title   !== undefined) data.title   = title;
    if (amount  !== undefined) data.amount  = parseFloat(amount);
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (notes   !== undefined) data.notes   = notes;

    const installment = await prisma.paymentInstallment.update({
      where: { id: req.params.iid }, data
    });
    res.json({ installment: { ...installment, effectiveStatus: effectiveStatus(installment) } });
  } catch (error) { next(error); }
});

// ─── DELETE INSTALLMENT ───────────────────────────────────────────────────────
// DELETE /api/payment-schedules/:id/installments/:iid  (PENDING with no payments only)
router.delete('/:id/installments/:iid', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const inst = await prisma.paymentInstallment.findUnique({
      where: { id: req.params.iid },
      include: { _count: { select: { payments: true } } }
    });
    if (!inst) return res.status(404).json({ error: 'Installment not found' });
    if (inst._count.payments > 0) return res.status(400).json({ error: 'Cannot delete an installment that has recorded payments' });
    if (inst.status !== 'PENDING') return res.status(400).json({ error: 'Only PENDING installments can be deleted' });

    await prisma.paymentInstallment.delete({ where: { id: req.params.iid } });
    res.json({ message: 'Installment deleted' });
  } catch (error) { next(error); }
});

// ─── RECORD PAYMENT ───────────────────────────────────────────────────────────
// POST /api/payment-schedules/:id/installments/:iid/pay
// Body: { amount, paymentDate, paymentMode?, referenceNumber?, notes? }
router.post('/:id/installments/:iid/pay', authenticate, authorize('SUPER_ADMIN', 'FINANCE'), async (req, res, next) => {
  try {
    const { amount, paymentDate, paymentMode, referenceNumber, notes } = req.body;
    if (!amount)      return res.status(400).json({ error: 'amount is required' });
    if (!paymentDate) return res.status(400).json({ error: 'paymentDate is required' });

    const inst = await prisma.paymentInstallment.findUnique({
      where: { id: req.params.iid },
      include: {
        schedule: { include: { project: { select: { name: true, managerId: true, clientId: true } } } }
      }
    });
    if (!inst) return res.status(404).json({ error: 'Installment not found' });
    if (inst.status === 'PAID') return res.status(400).json({ error: 'This installment is already fully paid' });

    const payAmt      = parseFloat(amount);
    const alreadyPaid = parseFloat(inst.paidAmount);
    const instAmt     = parseFloat(inst.amount);
    const remaining   = instAmt - alreadyPaid;

    if (payAmt <= 0)         return res.status(400).json({ error: 'Payment amount must be positive' });
    if (payAmt > remaining)  return res.status(400).json({ error: `Payment ₹${inr(payAmt)} exceeds remaining balance ₹${inr(remaining)}` });

    const newPaidAmount = alreadyPaid + payAmt;
    const newStatus     = newPaidAmount >= instAmt ? 'PAID' : 'PARTIAL';
    const leftOver      = instAmt - newPaidAmount;

    const [record] = await prisma.$transaction([
      prisma.paymentRecord.create({
        data: {
          installmentId:   req.params.iid,
          amount:          payAmt,
          paymentDate:     new Date(paymentDate),
          paymentMode:     paymentMode || 'BANK_TRANSFER',
          referenceNumber: referenceNumber || null,
          notes:           notes || null,
          recordedById:    req.user.id,
        },
        include: { recordedBy: { select: { id: true, name: true } } }
      }),
      prisma.paymentInstallment.update({
        where: { id: req.params.iid },
        data:  { paidAmount: newPaidAmount, status: newStatus }
      })
    ]);

    const project = inst.schedule.project;
    const notifBody = newStatus === 'PAID'
      ? `₹${inr(payAmt)} received — Installment ${inst.installmentNo} "${inst.title}" fully paid`
      : `₹${inr(payAmt)} received for installment ${inst.installmentNo} "${inst.title}". Remaining: ₹${inr(leftOver)}`;

    if (project.clientId) {
      try {
        const notifier = new NotificationService(req.app.get('io'));
        await notifier.send({
          userId: project.clientId, title: 'Payment Received', body: notifBody,
          type: 'PAYMENT_RECEIVED', entityType: 'payment_schedule', entityId: req.params.id
        });
      } catch (_) {}
    }

    res.status(201).json({
      record,
      installmentStatus: newStatus,
      paidAmount:        newPaidAmount,
      remaining:         leftOver
    });
  } catch (error) { next(error); }
});

// ─── SUMMARY ──────────────────────────────────────────────────────────────────
// GET /api/payment-schedules/:id/summary
router.get('/:id/summary', authenticate, async (req, res, next) => {
  try {
    const schedule = await prisma.paymentSchedule.findUnique({
      where: { id: req.params.id },
      select: {
        totalAmount:  true,
        installments: { select: { amount: true, paidAmount: true, dueDate: true, status: true } }
      }
    });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    const now = new Date();
    let totalPaid = 0, totalPending = 0, totalOverdue = 0;
    let countPaid = 0, countPending = 0, countPartial = 0, countOverdue = 0;

    for (const i of schedule.installments) {
      const amt  = parseFloat(i.amount);
      const paid = parseFloat(i.paidAmount);
      const es   = i.status === 'PAID' ? 'PAID' : (i.dueDate && new Date(i.dueDate) < now ? 'OVERDUE' : i.status);
      totalPaid += paid;
      if (es === 'PAID')    { countPaid++; }
      else if (es === 'OVERDUE') { totalOverdue += amt - paid; countOverdue++; }
      else if (es === 'PARTIAL') { totalPending += amt - paid; countPartial++; }
      else                       { totalPending += amt;        countPending++; }
    }

    res.json({
      totalAmount:       parseFloat(schedule.totalAmount),
      totalPaid:         Math.round(totalPaid * 100) / 100,
      totalPending:      Math.round(totalPending * 100) / 100,
      totalOverdue:      Math.round(totalOverdue * 100) / 100,
      totalInstallments: schedule.installments.length,
      countPaid, countPending, countPartial, countOverdue
    });
  } catch (error) { next(error); }
});

module.exports = router;
