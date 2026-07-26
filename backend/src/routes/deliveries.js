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
// status flip to DELIVERED, which is what unlocks /verify and /close-po.
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

    const notifier = new NotificationService(req.app.get('io'));

    // Notify site engineer
    await notifier.send({
      userId: delivery.purchaseOrder.createdById,
      title: fullyDelivered ? 'Material Delivered - Please Verify' : 'Partial Delivery Received',
      body: fullyDelivered
        ? `Material for PO ${delivery.purchaseOrder.poNumber} has been delivered to ${delivery.purchaseOrder.project.name}. Please verify.`
        : `Partial delivery received for PO ${delivery.purchaseOrder.poNumber} at ${delivery.purchaseOrder.project.name}. Some items are still pending — PO stays open.`,
      type: fullyDelivered ? 'VERIFICATION_NEEDED' : 'GENERAL', entityType: 'delivery', entityId: delivery.id
    });

    // Admin always sees every submission on the notifications page
    await notifier.sendToRole({
      role: 'SUPER_ADMIN',
      title: fullyDelivered ? 'Delivery Completed' : 'Partial Delivery Received',
      body: fullyDelivered
        ? `PO ${delivery.purchaseOrder.poNumber} fully delivered by ${req.user.name} to ${delivery.purchaseOrder.project.name}. Ready to close.`
        : `Partial delivery for PO ${delivery.purchaseOrder.poNumber} at ${delivery.purchaseOrder.project.name} by ${req.user.name}.`,
      type: fullyDelivered ? 'DELIVERY_COMPLETED' : 'GENERAL',
      entityType: 'delivery', entityId: delivery.id
    });

    // Finance gets a heads-up the moment it's fully complete
    if (fullyDelivered) {
      await notifier.sendToRole({
        role: 'FINANCE',
        title: 'PO Ready to Close',
        body: `PO ${delivery.purchaseOrder.poNumber} has been fully delivered by ${req.user.name}. You can close it now.`,
        type: 'DELIVERY_COMPLETED', entityType: 'delivery', entityId: delivery.id
      });
    }

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

// PUT /api/deliveries/:id/close-po
// Lightweight "everything arrived, close it" action for the delivery person
// who made the drop, or Finance/Admin from their dashboards. Only works once
// every item is fully received (delivery.status === 'DELIVERED'). This does
// NOT replace the engineer's /verify quality check — whichever happens first
// closes the PO; the other becomes a no-op.
router.put(
  '/:id/close-po',
  authenticate,
  authorize('DELIVERY_PERSON', 'FINANCE', 'SUPER_ADMIN', 'PROJECT_MANAGER', 'SITE_ENGINEER'),
  async (req, res, next) => {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: req.params.id },
        include: { purchaseOrder: { select: { id: true, poNumber: true, projectId: true, status: true } } }
      });
      if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

      if (req.user.role === 'DELIVERY_PERSON' && delivery.deliveryPersonId !== req.user.id) {
        return res.status(403).json({ error: 'You can only close deliveries assigned to you' });
      }

      if (delivery.status !== 'DELIVERED') {
        return res.status(400).json({
          error: 'This PO cannot be closed yet — some items are still pending delivery.'
        });
      }
      if (delivery.purchaseOrder.status === 'CLOSED') {
        return res.status(400).json({ error: 'This PO is already closed.' });
      }

      await prisma.delivery.update({
        where: { id: req.params.id },
        data: {
          status: 'VERIFIED',
          verifiedById: delivery.verifiedById || req.user.id,
          verifiedAt: delivery.verifiedAt || new Date()
        }
      });
      await prisma.purchaseOrder.update({
        where: { id: delivery.purchaseOrder.id },
        data: { status: 'CLOSED' }
      });

      const notifier = new NotificationService(req.app.get('io'));
      await notifier.sendToRole({
        role: 'FINANCE', title: 'PO Closed',
        body: `PO ${delivery.purchaseOrder.poNumber} closed by ${req.user.name}`,
        type: 'GENERAL', entityType: 'purchase_order', entityId: delivery.purchaseOrder.id
      });
      await notifier.sendToRole({
        role: 'SUPER_ADMIN', title: 'PO Closed',
        body: `PO ${delivery.purchaseOrder.poNumber} closed by ${req.user.name}`,
        type: 'GENERAL', entityType: 'purchase_order', entityId: delivery.purchaseOrder.id
      });

      const io = req.app.get('io');
      if (io) io.to(`project-${delivery.purchaseOrder.projectId}`).emit('delivery-update', delivery);

      res.json({ message: 'Purchase order closed.' });
    } catch (error) { next(error); }
  }
);

module.exports = router;