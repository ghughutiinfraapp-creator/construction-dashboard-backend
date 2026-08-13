const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

// GET /api/deliveries (delivery person sees their own; every other role sees ALL)
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

// GET /api/deliveries/meta/delivery-persons
// Lightweight list of active delivery people, used to populate the
// "Material Not Required" form's delivery-person picker. Placed under
// /meta so it doesn't collide with /:id.
router.get('/meta/delivery-persons', authenticate, authorize('SITE_ENGINEER', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const deliveryPersons = await prisma.user.findMany({
      where: { role: 'DELIVERY_PERSON', isActive: true },
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' }
    });
    res.json({ deliveryPersons });
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
// Stays DELIVERY_PERSON-only on purpose — this is what enforces the pickup
// gate. Engineers can never mark pickup, which is exactly why their photo
// submission stays locked until the delivery person does this step.
router.put('/:id/picked-up', authenticate, authorize('DELIVERY_PERSON'), async (req, res, next) => {
  try {
    const delivery = await prisma.delivery.update({
      where: { id: req.params.id },
      data: { status: 'PICKED_UP' }
    });
    res.json({ delivery, message: 'Marked as picked up' });
  } catch (error) { next(error); }
});

// PUT /api/deliveries/:id/delivered (delivery person OR site engineer/PM uploads photo)
// Body: { deliveryPhotoUrl, items?: [{ itemId, receivedQty }] }
// UPDATED: now also authorizes SITE_ENGINEER and PROJECT_MANAGER, so an
// engineer at the site can submit item photos/quantities themselves (e.g.
// if the delivery person can't, or the engineer is confirming what actually
// arrived on site) — without being able to create POs or deliveries, since
// there's no create route here, only this update-in-place one.
// `items` reports how much of each ordered item arrived in THIS drop.
// If the vendor couldn't deliver everything, the leftover items stay short
// of their ordered quantity, so the PO/Delivery are marked
// PARTIALLY_DELIVERED and stay open — this same route can be called again
// for the next drop. Only once every item's receivedQty reaches its ordered
// quantity does the status flip to DELIVERED, which is what unlocks
// /verify and /close-po.
router.put('/:id/delivered', authenticate, authorize('DELIVERY_PERSON', 'SITE_ENGINEER', 'PROJECT_MANAGER'), async (req, res, next) => {
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

    await notifier.send({
      userId: delivery.purchaseOrder.createdById,
      title: fullyDelivered ? 'Material Delivered - Please Verify' : 'Partial Delivery Received',
      body: fullyDelivered
        ? `Material for PO ${delivery.purchaseOrder.poNumber} has been delivered to ${delivery.purchaseOrder.project.name}. Please verify.`
        : `Partial delivery received for PO ${delivery.purchaseOrder.poNumber} at ${delivery.purchaseOrder.project.name}. Some items are still pending — PO stays open.`,
      type: fullyDelivered ? 'VERIFICATION_NEEDED' : 'GENERAL', entityType: 'delivery', entityId: delivery.id
    });

    await notifier.sendToRole({
      role: 'SUPER_ADMIN',
      title: fullyDelivered ? 'Delivery Completed' : 'Partial Delivery Received',
      body: fullyDelivered
        ? `PO ${delivery.purchaseOrder.poNumber} fully delivered by ${req.user.name} to ${delivery.purchaseOrder.project.name}. Ready to close.`
        : `Partial delivery for PO ${delivery.purchaseOrder.poNumber} at ${delivery.purchaseOrder.project.name} by ${req.user.name}.`,
      type: fullyDelivered ? 'DELIVERY_COMPLETED' : 'GENERAL',
      entityType: 'delivery', entityId: delivery.id
    });

    if (fullyDelivered) {
      await notifier.sendToRole({
        role: 'FINANCE',
        title: 'PO Ready to Close',
        body: `PO ${delivery.purchaseOrder.poNumber} has been fully delivered by ${req.user.name}. You can close it now.`,
        type: 'DELIVERY_COMPLETED', entityType: 'delivery', entityId: delivery.id
      });
    }

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

// PUT /api/deliveries/:id/items/:itemId/not-required
// Site engineer/PM reports that a pending PO item is not needed at this
// site, and picks EXACTLY which delivery person should be told — the
// notification goes ONLY to that person, regardless of who (if anyone) is
// actually assigned to this delivery. Pure notification action: nothing
// is written to the PO/item/delivery, no schema changes required.
// Body: { deliveryPersonId, photoUrl, note? } — photoUrl comes from the
// existing /api/uploads/photo route (entityType 'delivery_item', tied to
// this deliveryId), so it's already saved as a Photo row before this call.
router.put('/:id/items/:itemId/not-required', authenticate, authorize('SITE_ENGINEER', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { deliveryPersonId, photoUrl, note } = req.body;
    if (!deliveryPersonId) return res.status(400).json({ error: 'deliveryPersonId is required' });
    if (!photoUrl) return res.status(400).json({ error: 'photoUrl is required' });

    const [delivery, deliveryPerson] = await Promise.all([
      prisma.delivery.findUnique({
        where: { id: req.params.id },
        include: {
          purchaseOrder: { include: { items: true, project: { select: { id: true, name: true } } } }
        }
      }),
      prisma.user.findUnique({ where: { id: deliveryPersonId }, select: { id: true, role: true, isActive: true, name: true } })
    ]);
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

    const item = delivery.purchaseOrder.items.find(i => i.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: "Item not found on this delivery's PO" });
    if (item.receivedQty >= item.quantity) {
      return res.status(400).json({ error: 'This item has already been fully delivered.' });
    }

    if (!deliveryPerson || deliveryPerson.role !== 'DELIVERY_PERSON') {
      return res.status(400).json({ error: 'Selected user is not a delivery person' });
    }
    if (!deliveryPerson.isActive) {
      return res.status(400).json({ error: 'Selected delivery person is not active' });
    }

    const notifier = new NotificationService(req.app.get('io'));
    await notifier.send({
      userId: deliveryPerson.id,
      title: 'Material Not Required',
      body: `${req.user.name} says "${item.itemName}" is not required at ${delivery.purchaseOrder.project.name} (PO ${delivery.purchaseOrder.poNumber}).${note ? ` Note: ${note}` : ''} Please don't bring it.`,
      type: 'GENERAL', entityType: 'delivery', entityId: delivery.id
    });

    res.json({ message: `${deliveryPerson.name} has been notified that this item is not required.` });
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