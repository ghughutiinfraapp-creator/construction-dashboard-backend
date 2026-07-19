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
// Body: { deliveryPhotoUrl, items?: [{ itemId, receivedQty }] }
// `items` reports how much of each ordered item arrived in THIS drop.
// If the vendor couldn't deliver everything, the leftover items stay short of
// their ordered quantity, so the PO/Delivery are marked PARTIALLY_DELIVERED
// and stay open — this same route can be called again for the next drop.
// Only once every item's receivedQty reaches its ordered quantity does the
// status flip to DELIVERED, which is what unlocks /verify to close the PO.
router.put('/:id/delivered', authenticate, authorize('DELIVERY_PERSON'), async (req, res, next) => {
  try {
    const { deliveryPhotoUrl, items } = req.body;

    const existing = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: { purchaseOrder: { include: { items: true } } }
    });
    if (!existing) return res.status(404).json({ error: 'Delivery not found' });

    if (Array.isArray(items) && items.length > 0) {
      const errors = [];
      for (const { itemId, receivedQty } of items) {
        const poItem = existing.purchaseOrder.items.find(i => i.id === itemId);
        const qty = parseFloat(receivedQty);
        if (!poItem) { errors.push(`Item ${itemId} not found on this PO`); continue; }
        if (isNaN(qty) || qty <= 0) { errors.push(`${poItem.itemName}: receivedQty must be a positive number`); continue; }
        const remaining = poItem.quantity - poItem.receivedQty;
        if (qty > remaining) errors.push(`${poItem.itemName}: only ${remaining} ${poItem.unit} still pending (${qty} reported)`);
      }
      if (errors.length > 0) return res.status(400).json({ errors });

      await prisma.$transaction(
        items.map(({ itemId, receivedQty }) =>
          prisma.pOItem.update({
            where: { id: itemId },
            data: { receivedQty: { increment: parseFloat(receivedQty) } }
          })
        )
      );
    } else {
      // No item-level breakdown supplied — treat as a full delivery of everything still pending.
      await prisma.$transaction(
        existing.purchaseOrder.items
          .filter(i => i.receivedQty < i.quantity)
          .map(i => prisma.pOItem.update({ where: { id: i.id }, data: { receivedQty: i.quantity } }))
      );
    }

    const refreshedItems = await prisma.pOItem.findMany({ where: { purchaseOrderId: existing.purchaseOrder.id } });
    const fullyDelivered = refreshedItems.every(i => i.receivedQty >= i.quantity);

    const delivery = await prisma.delivery.update({
      where: { id: req.params.id },
      data: {
        status: fullyDelivered ? 'DELIVERED' : 'PARTIALLY_DELIVERED',
        deliveryPhotoUrl,
        deliveredAt: new Date()
      },
      include: { purchaseOrder: { select: { id: true, poNumber: true, createdById: true, projectId: true, project: { select: { name: true } } } } }
    });

    await prisma.purchaseOrder.update({
      where: { id: delivery.purchaseOrder.id },
      data: { status: fullyDelivered ? 'DELIVERED' : 'PARTIALLY_DELIVERED' }
    });

    // Notify site engineer
    const notifier = new NotificationService(req.app.get('io'));
    await notifier.send({
      userId: delivery.purchaseOrder.createdById,
      title: fullyDelivered ? 'Material Delivered - Please Verify' : 'Partial Delivery Received',
      body: fullyDelivered
        ? `Material for PO ${delivery.purchaseOrder.poNumber} has been delivered to ${delivery.purchaseOrder.project.name}. Please verify.`
        : `Partial delivery received for PO ${delivery.purchaseOrder.poNumber} at ${delivery.purchaseOrder.project.name}. Some items are still pending — PO stays open.`,
      type: fullyDelivered ? 'VERIFICATION_NEEDED' : 'GENERAL', entityType: 'delivery', entityId: delivery.id
    });

    // Real-time update
    const io = req.app.get('io');
    if (io) io.to(`project-${delivery.purchaseOrder.projectId}`).emit('delivery-update', delivery);

    res.json({
      delivery,
      items: refreshedItems,
      message: fullyDelivered
        ? 'Delivery completed. Engineer notified for verification.'
        : 'Partial delivery recorded. PO stays open for the remaining items.'
    });
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

    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

    if (verified) {
      if (delivery.status === 'PARTIALLY_DELIVERED') {
        return res.status(400).json({ error: 'Delivery is only partially complete — the PO cannot be closed until every item is fully delivered.' });
      }

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
