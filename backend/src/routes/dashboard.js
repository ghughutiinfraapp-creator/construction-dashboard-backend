const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/dashboard/stats (main KPIs)
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [
      totalProjects, activeProjects, totalEngineers,
      todayAttendance, pendingPOs, totalPOs,
      totalLabourers, activeTasks, overdueTasks
    ] = await Promise.all([
      prisma.project.count(),
      prisma.project.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { role: 'SITE_ENGINEER', isActive: true } }),
      prisma.attendance.count({ where: { date: today } }),
      prisma.purchaseOrder.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } } }),
      prisma.purchaseOrder.count(),
      prisma.labourer.count({ where: { isActive: true } }),
      prisma.task.count({ where: { status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } } }),
      prisma.task.count({ where: { status: { in: ['NOT_STARTED', 'IN_PROGRESS'] }, dueDate: { lt: new Date() } } })
    ]);

    // Calculate total PO spend
    const poSpend = await prisma.purchaseOrder.aggregate({
      where: { status: { in: ['CLOSED', 'VERIFIED', 'DELIVERED'] } },
      _sum: { totalAmount: true }
    });

    res.json({
      totalProjects, activeProjects, totalEngineers,
      todayAttendance, pendingPOs, totalPOs,
      totalLabourers, activeTasks, overdueTasks,
      totalSpend: poSpend._sum.totalAmount || 0
    });
  } catch (error) { next(error); }
});

// GET /api/dashboard/attendance-chart
router.get('/attendance-chart', authenticate, async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    startDate.setHours(0, 0, 0, 0);

    const records = await prisma.attendance.groupBy({
      by: ['date'],
      where: { date: { gte: startDate } },
      _count: { id: true },
      orderBy: { date: 'asc' }
    });

    res.json({ chartData: records.map(r => ({ date: r.date, count: r._count.id })) });
  } catch (error) { next(error); }
});

// GET /api/dashboard/po-pipeline
router.get('/po-pipeline', authenticate, async (req, res, next) => {
  try {
    const pipeline = await prisma.purchaseOrder.groupBy({
      by: ['status'],
      _count: { id: true },
      _sum: { totalAmount: true }
    });

    res.json({
      pipeline: pipeline.map(p => ({
        status: p.status, count: p._count.id, totalAmount: p._sum.totalAmount || 0
      }))
    });
  } catch (error) { next(error); }
});

// GET /api/dashboard/recent-activity
router.get('/recent-activity', authenticate, async (req, res, next) => {
  try {
    const [recentPOs, recentTasks, recentAttendance] = await Promise.all([
      prisma.purchaseOrder.findMany({
        take: 5, orderBy: { updatedAt: 'desc' },
        select: { id: true, poNumber: true, status: true, urgency: true, totalAmount: true, updatedAt: true,
          createdBy: { select: { name: true } }, project: { select: { name: true } } }
      }),
      prisma.task.findMany({
        take: 5, orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, status: true, priority: true, updatedAt: true,
          assignedTo: { select: { name: true } }, project: { select: { name: true } } }
      }),
      prisma.attendance.findMany({
        take: 5, orderBy: { punchInTime: 'desc' },
        select: { id: true, punchInTime: true, punchOutTime: true, totalHours: true,
          user: { select: { name: true } }, project: { select: { name: true } } }
      })
    ]);

    res.json({ recentPOs, recentTasks, recentAttendance });
  } catch (error) { next(error); }
});

// GET /api/dashboard/project-summary/:id
router.get('/project-summary/:id', authenticate, async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [project, taskStats, todayLabour, poStats] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        include: { manager: { select: { name: true } }, client: { select: { name: true } } }
      }),
      prisma.task.groupBy({ by: ['status'], where: { projectId }, _count: { id: true } }),
      prisma.labourAttendance.count({ where: { projectId, date: today, status: { in: ['PRESENT', 'HALF_DAY'] } } }),
      prisma.purchaseOrder.aggregate({
        where: { projectId, status: { in: ['CLOSED', 'VERIFIED'] } },
        _sum: { totalAmount: true }, _count: { id: true }
      })
    ]);

    res.json({
      project, taskStats, todayLabourCount: todayLabour,
      totalPOSpend: poStats._sum.totalAmount || 0, completedPOs: poStats._count.id
    });
  } catch (error) { next(error); }
});

module.exports = router;
