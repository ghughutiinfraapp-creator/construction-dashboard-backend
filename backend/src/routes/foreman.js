const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Recomputes LabourEntry.labourCount/totalCost from its worker rows.
// ABSENT workers count toward neither — they're kept on the entry only
// as a record that they were considered for the day.
async function recomputeEntryTotals(tx, labourEntryId) {
  const workers = await tx.labourAttendanceEntry.findMany({ where: { labourEntryId } });
  const counted = workers.filter((w) => w.status !== 'ABSENT');
  const totalCost = counted.reduce((sum, w) => sum + w.totalCost, 0);
  return tx.labourEntry.update({
    where: { id: labourEntryId },
    data: { labourCount: counted.length, totalCost },
  });
}

function wageForStatus(wageAmount, status) {
  if (status === 'HALF_DAY') return wageAmount / 2;
  if (status === 'ABSENT') return 0;
  return wageAmount;
}

/**
 * GET /api/foreman/sites
 * Returns all sites. Foremen are not assigned to individual sites; any
 * authenticated foreman can manage labour attendance at any site.
 */
router.get('/sites', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const sites = await prisma.project.findMany({
      select: {
        id: true,
        name: true,
        address: true,
        status: true,
        startDate: true,
        endDate: true,
        manager: { select: { id: true, name: true } },
        _count: { select: { labourEntries: true, labourMaster: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ sites });
  } catch (error) {
    next(error);
  }
});

async function findSite(siteId) {
  return prisma.project.findUnique({
    where: { id: siteId },
    include: {
      manager: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  });
}

/**
 * GET /api/foreman/sites/:siteId/roster
 * Returns the FULL company-wide worker directory (not just workers
 * registered at this site), since a worker added anywhere is usable
 * anywhere. `localWorkerIds` tells the client which of those workers
 * have actually worked at *this* site before, so the UI can group
 * "at this site" vs "from other sites".
 *
 * `LabourMaster.projectId` is kept only as "site where first registered"
 * metadata — it is intentionally NOT used to filter this list.
 */
router.get('/sites/:siteId/roster', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const { includeInactive } = req.query;

    const site = await findSite(siteId);
    if (!site) return res.status(404).json({ message: 'Site not found.' });

    const [roster, localAttendance] = await Promise.all([
      prisma.labourMaster.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: { name: 'asc' },
      }),
      prisma.labourAttendanceEntry.findMany({
        where: { labourEntry: { projectId: siteId } },
        select: { labourMasterId: true },
        distinct: ['labourMasterId'],
      }),
    ]);

    const localWorkerIds = localAttendance.map((a) => a.labourMasterId);

    res.json({ roster, localWorkerIds });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/foreman/sites/:siteId/roster
 * Adds a new labour to the company-wide directory (one-time setup per
 * worker, usable at any site thereafter). `siteId` is only recorded as
 * where the worker was first registered.
 * Body: { name, phone?, tradeType, defaultWage, aadhaarNumber? }
 */
router.post('/sites/:siteId/roster', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const { name, phone, tradeType, defaultWage, aadhaarNumber } = req.body;

    if (!name || !tradeType || defaultWage === undefined) {
      return res.status(400).json({ message: 'name, tradeType and defaultWage are required.' });
    }
    const parsedWage = parseFloat(defaultWage);
    if (isNaN(parsedWage) || parsedWage < 0) {
      return res.status(400).json({ message: 'defaultWage must be a valid non-negative number.' });
    }

    const site = await findSite(siteId);
    if (!site) return res.status(404).json({ message: 'Site not found.' });

    const worker = await prisma.labourMaster.create({
      data: {
        projectId: siteId,
        name,
        phone: phone || null,
        tradeType,
        defaultWage: parsedWage,
        aadhaarNumber: aadhaarNumber || null,
      },
    });

    res.status(201).json({ worker });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/foreman/roster/:workerId
 * Edits a worker's directory entry (e.g. updated wage) or deactivates
 * them. Since the directory is global, this affects the worker
 * everywhere, not just at one site.
 */
router.put('/roster/:workerId', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { workerId } = req.params;
    const { name, phone, tradeType, defaultWage, aadhaarNumber, isActive } = req.body;

    const existing = await prisma.labourMaster.findUnique({ where: { id: workerId } });
    if (!existing) return res.status(404).json({ message: 'Worker not found.' });

    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (tradeType !== undefined) data.tradeType = tradeType;
    if (aadhaarNumber !== undefined) data.aadhaarNumber = aadhaarNumber;
    if (isActive !== undefined) data.isActive = isActive;
    if (defaultWage !== undefined) {
      const p = parseFloat(defaultWage);
      if (isNaN(p) || p < 0) return res.status(400).json({ message: 'defaultWage must be a valid non-negative number.' });
      data.defaultWage = p;
    }

    const worker = await prisma.labourMaster.update({ where: { id: workerId }, data });
    res.json({ worker });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/foreman/sites/:siteId/labour
 * Returns daily labour entries for a site (each with its worker breakdown).
 * Query params: page, limit, date (YYYY-MM-DD)
 */
router.get('/sites/:siteId/labour', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const { page = 1, limit = 20, date } = req.query;

    const site = await findSite(siteId);
    if (!site) return res.status(404).json({ message: 'Site not found.' });

    const where = { projectId: siteId };
    if (date) {
      const start = startOfDay(date);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.date = { gte: start, lt: end };
    }

    const [entries, total] = await Promise.all([
      prisma.labourEntry.findMany({
        where,
        skip: (page - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          createdBy: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          workers: { include: { labourMaster: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.labourEntry.count({ where }),
    ]);

    const totalCost = entries.reduce((sum, e) => sum + e.totalCost, 0);

    res.json({
      entries,
      total,
      totalCost,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/foreman/sites/:siteId/labour
 * Submits (or appends to) today's labour entry for a site — one tick-mark
 * submission covering the whole roster for that date.
 *
 * Body: {
 *   date, notes?,
 *   workers: [
 *     { labourMasterId, wageAmount, status },                          // any worker in the company directory
 *     { newWorker: { name, tradeType, phone?, aadhaarNumber? }, wageAmount, status }  // add-on-the-fly
 *   ]
 * }
 *
 * One LabourEntry per site per date: re-submitting the same date upserts
 * each worker's attendance row rather than creating a duplicate entry, so
 * a foreman can add latecomers later in the day without starting over.
 *
 * labourMasterId can belong to ANY site's original registration — the
 * worker directory is company-wide, so a worker added while working at
 * Site A can be ticked in at Site B without re-entering their details.
 */
router.post('/sites/:siteId/labour', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const { date, notes, workers } = req.body;

    if (!date || !Array.isArray(workers) || workers.length === 0) {
      return res.status(400).json({ message: 'date and a non-empty workers array are required.' });
    }
    for (const w of workers) {
      if (w.wageAmount === undefined || isNaN(parseFloat(w.wageAmount))) {
        return res.status(400).json({ message: 'Each worker entry needs a valid wageAmount.' });
      }
      if (!w.labourMasterId && !w.newWorker?.name) {
        return res.status(400).json({ message: 'Each worker entry needs either labourMasterId or newWorker.name.' });
      }
    }

    const site = await findSite(siteId);
    if (!site) return res.status(404).json({ message: 'Site not found.' });

    // Confirm every labourMasterId exists in the (company-wide) directory.
    // This is no longer scoped to this site's projectId — a worker
    // registered at any site is valid here too. This still turns
    // stale/invalid IDs into a clear validation response instead of a
    // Prisma constraint error.
    const rosterIds = [...new Set(workers.map((w) => w.labourMasterId).filter(Boolean))];
    if (rosterIds.length > 0) {
      const validWorkers = await prisma.labourMaster.count({
        where: { id: { in: rosterIds } },
      });
      if (validWorkers !== rosterIds.length) {
        return res.status(400).json({ message: 'One or more selected workers could not be found.' });
      }
    }

    const entryDate = startOfDay(date);

    const entry = await prisma.$transaction(async (tx) => {
      let labourEntry = await tx.labourEntry.findFirst({ where: { projectId: siteId, date: entryDate } });
      if (!labourEntry) {
        labourEntry = await tx.labourEntry.create({
          data: { projectId: siteId, createdById: req.user.id, date: entryDate, notes: notes || null },
        });
      } else if (notes !== undefined) {
        labourEntry = await tx.labourEntry.update({ where: { id: labourEntry.id }, data: { notes } });
      }

      for (const w of workers) {
        const status = w.status || 'PRESENT';
        const wageAmount = parseFloat(w.wageAmount);
        const totalCost = wageForStatus(wageAmount, status);

        let labourMasterId = w.labourMasterId;
        if (!labourMasterId) {
          const created = await tx.labourMaster.create({
            data: {
              projectId: siteId,
              name: w.newWorker.name,
              phone: w.newWorker.phone || null,
              tradeType: w.newWorker.tradeType || 'General',
              defaultWage: wageAmount,
              aadhaarNumber: w.newWorker.aadhaarNumber || null,
            },
          });
          labourMasterId = created.id;
        }

        await tx.labourAttendanceEntry.upsert({
          where: { labourEntryId_labourMasterId: { labourEntryId: labourEntry.id, labourMasterId } },
          update: { wageAmount, status, totalCost },
          create: { labourEntryId: labourEntry.id, labourMasterId, wageAmount, status, totalCost },
        });
      }

      await recomputeEntryTotals(tx, labourEntry.id);

      return tx.labourEntry.findUnique({
        where: { id: labourEntry.id },
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          workers: { include: { labourMaster: true } },
        },
      });
    });

    const notifier = new NotificationService(req.app.get('io'));
    if (site.manager?.id) {
      await notifier.send({
        userId: site.manager.id,
        title: 'Labour Entry Updated',
        body: `${req.user.name} logged ${entry.labourCount} labourer(s) for "${site.name}".`,
        type: 'GENERAL',
        entityType: 'labourEntry',
        entityId: entry.id,
      });
    }

    // Notify client, PM and site engineer(s) that labour is working on site today
    const siteEngineers = await prisma.user.findMany({
      where: { role: 'SITE_ENGINEER', attendance: { some: { projectId: siteId } }, isActive: true },
      select: { id: true },
    });
    const workingDate = entryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const recipientIds = [site.manager?.id, site.client?.id, ...siteEngineers.map((u) => u.id)]
      .filter(Boolean)
      .filter((id, i, arr) => arr.indexOf(id) === i);

    if (recipientIds.length > 0) {
      await notifier.sendToMultiple({
        userIds: recipientIds,
        title: 'Labour Assigned Today',
        body: `${entry.labourCount} labourer${entry.labourCount > 1 ? 's' : ''} working on "${site.name}" today (${workingDate}).`,
        type: 'GENERAL',
        entityType: 'labourEntry',
        entityId: entry.id,
      });
    }

    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/foreman/labour/:entryId/workers/:workerEntryId
 * Removes a single worker from a day's entry (e.g. ticked by mistake).
 * Only allowed the same day the entry was created.
 */
router.delete('/labour/:entryId/workers/:workerEntryId', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { entryId, workerEntryId } = req.params;

    const existing = await prisma.labourEntry.findFirst({ where: { id: entryId, createdById: req.user.id } });
    if (!existing) return res.status(404).json({ message: 'Entry not found or not yours.' });

    const today = startOfDay(new Date());
    if (startOfDay(existing.date).getTime() !== today.getTime()) {
      return res.status(403).json({ message: 'Labour entries can only be edited on the same day.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.labourAttendanceEntry.delete({ where: { id: workerEntryId } });
      await recomputeEntryTotals(tx, entryId);
    });

    res.json({ message: 'Worker removed from entry.' });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/foreman/labour/:entryId
 * Delete a whole day's labour entry (only same-day deletion allowed).
 */
router.delete('/labour/:entryId', authenticate, authorize('FOREMAN'), async (req, res, next) => {
  try {
    const { entryId } = req.params;

    const existing = await prisma.labourEntry.findFirst({ where: { id: entryId, createdById: req.user.id } });
    if (!existing) return res.status(404).json({ message: 'Entry not found or not yours.' });

    const today = startOfDay(new Date());
    if (startOfDay(existing.date).getTime() !== today.getTime()) {
      return res.status(403).json({ message: 'Labour entries can only be deleted on the same day.' });
    }

    await prisma.labourEntry.delete({ where: { id: entryId } }); // cascades to worker rows
    res.json({ message: 'Labour entry deleted.' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/foreman/sites/:siteId/labour/summary
 * Returns aggregated labour cost summary for a site, with a trade-wise breakdown.
 */
router.get('/sites/:siteId/labour/summary', authenticate, authorize('FOREMAN', 'PROJECT_MANAGER', 'SUPER_ADMIN', 'SUPER_ADMIN_VIEW'), async (req, res, next) => {
  try {
    const { siteId } = req.params;

    const entries = await prisma.labourEntry.findMany({
      where: { projectId: siteId },
      select: { labourCount: true, totalCost: true },
    });

    const workerRecords = await prisma.labourAttendanceEntry.findMany({
      where: { labourEntry: { projectId: siteId }, status: { not: 'ABSENT' } },
      select: { totalCost: true, labourMaster: { select: { tradeType: true } } },
    });

    const totalLabourDays = entries.reduce((sum, e) => sum + e.labourCount, 0);
    const totalCost = entries.reduce((sum, e) => sum + e.totalCost, 0);

    const tradeBreakdown = {};
    for (const w of workerRecords) {
      const trade = w.labourMaster.tradeType;
      if (!tradeBreakdown[trade]) tradeBreakdown[trade] = { tradeType: trade, count: 0, totalCost: 0 };
      tradeBreakdown[trade].count += 1;
      tradeBreakdown[trade].totalCost += w.totalCost;
    }

    res.json({
      totalEntries: entries.length,
      totalLabourDays,
      totalCost,
      tradeBreakdown: Object.values(tradeBreakdown),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/foreman/sites/:siteId/labour/monthly-report?month=YYYY-MM
 * Returns every roster worker with one status per calendar day and the
 * wage earned during the month (present = full wage, half-day = half wage).
 */
router.get(
  '/sites/:siteId/labour/monthly-report',
  authenticate,
  authorize('FOREMAN', 'PROJECT_MANAGER', 'SUPER_ADMIN', 'SUPER_ADMIN_VIEW', 'FINANCE'),
  async (req, res, next) => {
    try {
      const { siteId } = req.params;
      const { month } = req.query;

      if (!/^\d{4}-\d{2}$/.test(month || '')) {
        return res.status(400).json({ message: 'month is required in YYYY-MM format.' });
      }

      const [year, monthNumber] = month.split('-').map(Number);
      if (monthNumber < 1 || monthNumber > 12) {
        return res.status(400).json({ message: 'month must be between 01 and 12.' });
      }

      const site = await prisma.project.findUnique({
        where: { id: siteId },
        select: { id: true, name: true },
      });
      if (!site) return res.status(404).json({ message: 'Site not found.' });

      const startDate = new Date(year, monthNumber - 1, 1);
      const endDate = new Date(year, monthNumber, 1);
      const today = startOfDay(new Date());
      const lastCalendarDay = new Date(year, monthNumber, 0);
      const reportEndDay =
        year === today.getFullYear() && monthNumber - 1 === today.getMonth()
          ? today
          : lastCalendarDay;

      const days = [];
      if (startDate <= reportEndDay) {
        for (let day = 1; day <= reportEndDay.getDate(); day += 1) {
          days.push(`${month}-${String(day).padStart(2, '0')}`);
        }
      }

      // Monthly report stays site-scoped: it should only show workers who
      // actually had an attendance entry at THIS site during the month,
      // not the whole company directory (which is now global).
      const workers = await prisma.labourMaster.findMany({
        where: {
          entries: { some: { labourEntry: { projectId: siteId, date: { gte: startDate, lt: endDate } } } },
        },
        include: {
          entries: {
            where: { labourEntry: { date: { gte: startDate, lt: endDate }, projectId: siteId } },
            include: { labourEntry: { select: { date: true } } },
          },
        },
        orderBy: { name: 'asc' },
      });

      const report = workers.map((worker) => {
        const attendanceByDate = new Map(
          worker.entries.map((entry) => {
            const date = entry.labourEntry.date;
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
              date.getDate()
            ).padStart(2, '0')}`;
            return [key, entry];
          })
        );

        let daysPresent = 0;
        let halfDays = 0;
        let daysAbsent = 0;
        let monthlyWage = 0;

        const attendance = days.map((date) => {
          const entry = attendanceByDate.get(date);
          const status = entry?.status || 'ABSENT';
          const dailyWage = entry?.wageAmount ?? worker.defaultWage;
          const earned = wageForStatus(dailyWage, status);

          if (status === 'PRESENT') daysPresent += 1;
          else if (status === 'HALF_DAY') halfDays += 1;
          else daysAbsent += 1;
          monthlyWage += earned;

          return { date, status, dailyWage, earned };
        });

        return {
          id: worker.id,
          name: worker.name,
          phone: worker.phone,
          tradeType: worker.tradeType,
          defaultWage: worker.defaultWage,
          isActive: worker.isActive,
          attendance,
          daysPresent,
          halfDays,
          daysAbsent,
          monthlyWage,
        };
      });

      res.json({
        site,
        month,
        days,
        report,
        totalWorkers: report.length,
        totalMonthlyWage: report.reduce((sum, worker) => sum + worker.monthlyWage, 0),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/foreman/labour/total-cost
 * Returns aggregated labour cost across ALL sites — used by the dashboard's
 * Budget Spent card. Mirrors the totalCost logic in the per-site summary
 * route above, but without a projectId filter.
 */
router.get(
  '/labour/total-cost',
  authenticate,
  authorize('SUPER_ADMIN', 'SUPER_ADMIN_VIEW', 'FINANCE'),
  async (req, res, next) => {
    try {
      const result = await prisma.labourEntry.aggregate({
        _sum: { totalCost: true },
      });

      res.json({ totalLabourCost: result._sum.totalCost || 0 });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;