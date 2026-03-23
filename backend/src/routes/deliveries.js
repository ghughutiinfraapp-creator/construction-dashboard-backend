const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

// GET /api/deliveries (delivery person sees their assignments)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (req.user.role === 'DELIVERY_PERSON') where.deliveryPersonId = req.user.id;
    if (status) where.status = status;

    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        include: {
          purchaseOrder: {
            include: {
              items: true,
              project: { select: { id: true, name: true, address: true } },
              vendor: { select: { id: true, name: true, address: true, phone: true } },
              createdBy: { select: { id: true, name: true, phone: true } }
            }
          },
          deliveryPerson: { select: { id: true, name: true } },
          verifiedBy: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.delivery.count({ where })
    ]);
    res.json({ deliveries, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// GET /api/deliveries/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrder: {
          include: {
            items: true,
            project: { select: { id: true, name: true, address: true } },
            vendor: true,
            createdBy: { select: { id: true, name: true, phone: true } }
          }
        },
        deliveryPerson: { select: { id: true, name: true, phone: true } },
        verifiedBy: { select: { id: true, name: true } }
      }
    });
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    res.json({ delivery });
  } catch (error) { next(error); }
});

// PUT /api/deliveries/:id/picked-up
router.put('/:id/picked-up', authenticate, authorize('DELIVERY_PERSON'), async (req, res, next) => {
  try {
    const delivery = await prisma.delivery.update({
      where: { id: req.params.id },
      data: { status: 'PICKED_UP' }
    });
    res.json({ delivery, message: 'Marked as picked up' });
  } catch (error) { next(error); }
});

// PUT /api/deliveries/:id/delivered (delivery person uploads photo)
router.put('/:id/delivered', authenticate, authorize('DELIVERY_PERSON'), async (req, res, next) => {
  try {
    const { deliveryPhotoUrl } = req.body;
    const delivery = await prisma.delivery.update({
      where: { id: req.params.id },
      data: { status: 'DELIVERED', deliveryPhotoUrl, deliveredAt: new Date() },
      include: { purchaseOrder: { select: { id: true, poNumber: true, createdById: true, projectId: true, project: { select: { name: true } } } } }
    });

    // Update PO status
    await prisma.purchaseOrder.update({
      where: { id: delivery.purchaseOrder.id },
      data: { status: 'DELIVERED' }
    });

    // Notify site engineer to verify
    const notifier = new NotificationService(req.app.get('io'));
    await notifier.send({
      userId: delivery.purchaseOrder.createdById,
      title: 'Material Delivered - Please Verify',
      body: `Material for PO ${delivery.purchaseOrder.poNumber} has been delivered to ${delivery.purchaseOrder.project.name}. Please verify.`,
      type: 'VERIFICATION_NEEDED', entityType: 'delivery', entityId: delivery.id
    });

    // Real-time update
    const io = req.app.get('io');
    if (io) io.to(`project-${delivery.purchaseOrder.projectId}`).emit('delivery-update', delivery);

    res.json({ delivery, message: 'Delivery completed. Engineer notified for verification.' });
  } catch (error) { next(error); }
});

// PUT /api/deliveries/:id/verify (site engineer verifies and closes)
router.put('/:id/verify', authenticate, authorize('SITE_ENGINEER', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { verified, issueDescription, issuePhotoUrl } = req.body;
    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: { purchaseOrder: { select: { id: true, poNumber: true, projectId: true } } }
    });

    if (verified) {
      await prisma.delivery.update({
        where: { id: req.params.id },
        data: { status: 'VERIFIED', verifiedById: req.user.id, verifiedAt: new Date() }
      });
      await prisma.purchaseOrder.update({
        where: { id: delivery.purchaseOrder.id },
        data: { status: 'CLOSED' }
      });

      // Notify finance + admin
      const notifier = new NotificationService(req.app.get('io'));
      await notifier.sendToRole({
        role: 'FINANCE', title: 'PO Verified & Closed',
        body: `PO ${delivery.purchaseOrder.poNumber} verified and closed by ${req.user.name}`,
        type: 'GENERAL', entityType: 'purchase_order', entityId: delivery.purchaseOrder.id
      });
      await notifier.sendToRole({
        role: 'SUPER_ADMIN', title: 'PO Verified & Closed',
        body: `PO ${delivery.purchaseOrder.poNumber} verified and closed`,
        type: 'GENERAL', entityType: 'purchase_order', entityId: delivery.purchaseOrder.id
      });

      res.json({ message: 'Delivery verified. PO closed.' });
    } else {
      await prisma.delivery.update({
        where: { id: req.params.id },
        data: { status: 'ISSUE_RAISED', issueDescription, issuePhotoUrl, verifiedById: req.user.id }
      });

      const notifier = new NotificationService(req.app.get('io'));
      await notifier.sendToRole({
        role: 'FINANCE', title: 'Delivery Issue Raised',
        body: `Issue with PO ${delivery.purchaseOrder.poNumber}: ${issueDescription}`,
        type: 'GENERAL', entityType: 'delivery', entityId: delivery.id
      });

      res.json({ message: 'Issue raised. Finance team notified.' });
    }
  } catch (error) { next(error); }
});

module.exports = router;
