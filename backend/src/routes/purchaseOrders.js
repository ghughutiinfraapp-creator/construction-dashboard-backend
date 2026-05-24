const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { generatePONumber } = require('../utils/helpers');
const NotificationService = require('../services/notificationService');

// GET /api/purchase-orders
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { projectId, status, createdById, page = 1, limit = 20 } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (createdById) where.createdById = createdById;
    if (req.user.role === 'SITE_ENGINEER') where.createdById = req.user.id;
    if (req.user.role === 'DELIVERY_PERSON') where.delivery = { deliveryPersonId: req.user.id };

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where, skip: (page - 1) * limit, take: parseInt(limit),
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          items: true,
          delivery: { include: { deliveryPerson: { select: { id: true, name: true } } } },
          _count: { select: { items: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.purchaseOrder.count({ where })
    ]);
    res.json({ purchaseOrders: orders, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// POST /api/purchase-orders (Site Engineer creates PO)
router.post('/', authenticate, authorize('SITE_ENGINEER', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { projectId, urgency, notes, items } = req.body;
    const poNumber = await generatePONumber();

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber, projectId, createdById: req.user.id,
        status: 'SUBMITTED', urgency: urgency || 'NORMAL', notes,
        items: {
          create: items.map(item => ({
            itemName: item.itemName, itemCategory: item.itemCategory,
            quantity: item.quantity, unit: item.unit,
            unitPrice: item.unitPrice ? parseFloat(item.unitPrice) : null,
            totalPrice: item.unitPrice ? parseFloat(item.unitPrice) * item.quantity : null,
            brand: item.brand, notes: item.notes
          }))
        }
      },
      include: { items: true, project: { select: { id: true, name: true } } }
    });

    // Notify finance team
    const notifier = new NotificationService(req.app.get('io'));
    await notifier.sendToRole({
      role: 'FINANCE', title: 'New Purchase Order',
      body: `PO ${poNumber} submitted by ${req.user.name} for ${po.project.name} [${urgency}]`,
      type: 'PO_SUBMITTED', entityType: 'purchase_order', entityId: po.id
    });

    res.status(201).json({ purchaseOrder: po });
  } catch (error) { next(error); }
});

// GET /api/purchase-orders/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, name: true, address: true } },
        createdBy: { select: { id: true, name: true, phone: true } },
        vendor: true, approvedBy: { select: { id: true, name: true } },
        items: true,
        delivery: { include: { deliveryPerson: { select: { id: true, name: true, phone: true } }, verifiedBy: { select: { id: true, name: true } } } },
        photos: { include: { uploadedBy: { select: { id: true, name: true } } } }
      }
    });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ purchaseOrder: po });
  } catch (error) { next(error); }
});

// PUT /api/purchase-orders/:id/approve (Finance approves)
router.put('/:id/approve', authenticate, authorize('FINANCE', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', approvedById: req.user.id, approvedAt: new Date() },
      include: { createdBy: { select: { id: true, name: true } }, project: { select: { name: true } } }
    });

    const notifier = new NotificationService(req.app.get('io'));
    await notifier.send({
      userId: po.createdById, title: 'PO Approved',
      body: `Your PO ${po.poNumber} has been approved`,
      type: 'PO_APPROVED', entityType: 'purchase_order', entityId: po.id
    });

    res.json({ purchaseOrder: po });
  } catch (error) { next(error); }
});

// PUT /api/purchase-orders/:id/reject (Finance rejects)
router.put('/:id/reject', authenticate, authorize('FINANCE', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;
    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectionReason, approvedById: req.user.id }
    });

    const notifier = new NotificationService(req.app.get('io'));
    await notifier.send({
      userId: po.createdById, title: 'PO Rejected',
      body: `Your PO ${po.poNumber} was rejected: ${rejectionReason}`,
      type: 'PO_REJECTED', entityType: 'purchase_order', entityId: po.id
    });

    res.json({ purchaseOrder: po });
  } catch (error) { next(error); }
});

// PUT /api/purchase-orders/:id/assign-vendor (Finance assigns vendor)
router.put('/:id/assign-vendor', authenticate, authorize('FINANCE', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { vendorId, items } = req.body;

    // Update items with final pricing if provided
    if (items && items.length > 0) {
      await Promise.all(items.map(item =>
        prisma.pOItem.update({
          where: { id: item.id },
          data: { unitPrice: parseFloat(item.unitPrice), totalPrice: parseFloat(item.unitPrice) * item.quantity }
        })
      ));
    }

    // Calculate total
    const allItems = await prisma.pOItem.findMany({ where: { purchaseOrderId: req.params.id } });
    const totalAmount = allItems.reduce((sum, item) => sum + (parseFloat(item.totalPrice) || 0), 0);

    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { vendorId, totalAmount, status: 'VENDOR_ASSIGNED' },
      include: { vendor: true, createdBy: { select: { id: true } } }
    });

    const notifier = new NotificationService(req.app.get('io'));
    await notifier.send({
      userId: po.createdById, title: 'Vendor Assigned to PO',
      body: `${po.vendor.name} assigned to PO ${po.poNumber}`,
      type: 'PO_APPROVED', entityType: 'purchase_order', entityId: po.id
    });

    res.json({ purchaseOrder: po });
  } catch (error) { next(error); }
});

// POST /api/purchase-orders/:id/transfer-materials
// Transfers unused materials from this PO to another project, creating a closed PO there.
// Body: { targetProjectId, items: [{ itemId, quantity }], notes? }
router.post('/:id/transfer-materials', authenticate, authorize('FINANCE', 'PROJECT_MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { targetProjectId, items, notes } = req.body;
    if (!targetProjectId) return res.status(400).json({ error: 'targetProjectId is required' });
    if (!items || items.length === 0) return res.status(400).json({ error: 'items array is required' });

    const sourcePO = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { items: true, project: { select: { name: true } } }
    });
    if (!sourcePO) return res.status(404).json({ error: 'Purchase order not found' });

    const targetProject = await prisma.project.findUnique({
      where: { id: targetProjectId },
      select: { id: true, name: true }
    });
    if (!targetProject) return res.status(404).json({ error: 'Target project not found' });

    // Validate each item: must belong to source PO and have enough remaining qty
    const transferMap = new Map(items.map(i => [i.itemId, parseFloat(i.quantity)]));
    const errors = [];
    for (const [itemId, qty] of transferMap) {
      const sourceItem = sourcePO.items.find(i => i.id === itemId);
      if (!sourceItem) { errors.push(`Item ${itemId} not found in this PO`); continue; }
      const remaining = sourceItem.quantity - (sourceItem.transferredQty || 0);
      if (qty <= 0) errors.push(`Transfer quantity for ${sourceItem.itemName} must be positive`);
      else if (qty > remaining) errors.push(`${sourceItem.itemName}: only ${remaining} ${sourceItem.unit} available (${qty} requested)`);
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    const poNumber = await generatePONumber();

    const [transferPO] = await prisma.$transaction(async (tx) => {
      // Deduct transferred quantities from source items
      await Promise.all(
        [...transferMap.entries()].map(([itemId, qty]) =>
          tx.pOItem.update({
            where: { id: itemId },
            data: { transferredQty: { increment: qty } }
          })
        )
      );

      // Build transfer PO items with current pricing from source
      const transferItems = items.map(({ itemId, quantity }) => {
        const src = sourcePO.items.find(i => i.id === itemId);
        const qty = parseFloat(quantity);
        const unitPrice = src.unitPrice ? parseFloat(src.unitPrice) : null;
        return {
          itemName: src.itemName, itemCategory: src.itemCategory,
          quantity: qty, unit: src.unit,
          unitPrice: unitPrice ? unitPrice : null,
          totalPrice: unitPrice ? unitPrice * qty : null,
          brand: src.brand,
          notes: `Transferred from PO ${sourcePO.poNumber} (${sourcePO.project.name})`
        };
      });

      const totalAmount = transferItems.reduce((sum, i) => sum + (i.totalPrice || 0), 0);

      const newPO = await tx.purchaseOrder.create({
        data: {
          poNumber, projectId: targetProjectId,
          createdById: req.user.id,
          status: 'CLOSED',
          urgency: sourcePO.urgency,
          transferredFromId: sourcePO.id,
          totalAmount: totalAmount || null,
          notes: notes
            ? `Material transfer from PO ${sourcePO.poNumber} (${sourcePO.project.name}). ${notes}`
            : `Material transfer from PO ${sourcePO.poNumber} (${sourcePO.project.name})`,
          items: { create: transferItems }
        },
        include: {
          items: true,
          project: { select: { id: true, name: true } },
          transferredFrom: { select: { id: true, poNumber: true } }
        }
      });

      return [newPO];
    });

    const notifier = new NotificationService(req.app.get('io'));
    await notifier.sendToRole({
      role: 'FINANCE', title: 'Materials Transferred',
      body: `${items.length} item(s) transferred from PO ${sourcePO.poNumber} to ${targetProject.name} (new PO ${poNumber})`,
      type: 'PO_SUBMITTED', entityType: 'purchase_order', entityId: transferPO.id
    });

    res.status(201).json({ transferPO, sourcePOId: sourcePO.id });
  } catch (error) { next(error); }
});

// PUT /api/purchase-orders/:id/assign-delivery (Assign delivery person)
router.put('/:id/assign-delivery', authenticate, authorize('FINANCE', 'PROJECT_MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { deliveryPersonId } = req.body;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { vendor: true, project: { select: { name: true, address: true } } }
    });

    const delivery = await prisma.delivery.create({
      data: {
        purchaseOrderId: req.params.id,
        deliveryPersonId,
        pickupAddress: po.vendor?.address || 'Vendor address',
        dropAddress: po.project.address || 'Site address'
      }
    });

    await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: { status: 'READY_FOR_PICKUP' } });

    const notifier = new NotificationService(req.app.get('io'));
    await notifier.send({
      userId: deliveryPersonId, title: 'New Pickup Assignment',
      body: `Pick up materials for PO ${po.poNumber} from ${po.vendor?.name}`,
      type: 'DELIVERY_ASSIGNED', entityType: 'delivery', entityId: delivery.id
    });

    res.json({ delivery });
  } catch (error) { next(error); }
});

module.exports = router;
