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
