const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Clean existing data
  await prisma.notification.deleteMany();
  await prisma.labourAttendance.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.pOItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.task.deleteMany();
  await prisma.labourer.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.project.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.materialCatalog.deleteMany();

  const password = await bcrypt.hash('password123', 12);

  // ─── USERS ──────────────────────────────────────────────────────
  const admin = await prisma.user.create({
    data: { name: 'Admin User', email: 'admin@construction.com', phone: '9999900001', password, role: 'SUPER_ADMIN' }
  });
  const pm = await prisma.user.create({
    data: { name: 'Rajesh Kumar', email: 'pm@construction.com', phone: '9999900002', password, role: 'PROJECT_MANAGER' }
  });
  const engineer1 = await prisma.user.create({
    data: { name: 'Amit Sharma', email: 'engineer1@construction.com', phone: '9999900003', password, role: 'SITE_ENGINEER' }
  });
  const engineer2 = await prisma.user.create({
    data: { name: 'Suresh Patel', email: 'engineer2@construction.com', phone: '9999900004', password, role: 'SITE_ENGINEER' }
  });
  const finance = await prisma.user.create({
    data: { name: 'Priya Verma', email: 'finance@construction.com', phone: '9999900005', password, role: 'FINANCE' }
  });
  const delivery = await prisma.user.create({
    data: { name: 'Ravi Singh', email: 'delivery@construction.com', phone: '9999900006', password, role: 'DELIVERY_PERSON' }
  });
  const client = await prisma.user.create({
    data: { name: 'Mohit Agarwal', email: 'client@construction.com', phone: '9999900007', password, role: 'CLIENT' }
  });
  await prisma.user.create({
    data: { name: 'Vikram Thakur', email: 'foreman@construction.com', phone: '9999900008', password, role: 'FOREMAN' }
  });

  console.log('✅ Users created (all passwords: password123)');

  // ─── PROJECTS ───────────────────────────────────────────────────
  const project1 = await prisma.project.create({
    data: {
      name: 'Green Valley Residency', description: 'A 3-floor residential building project in Sector 45, Noida',
      address: 'Plot 45, Sector 45, Noida, UP', status: 'ACTIVE',
      managerId: pm.id, clientId: client.id, budget: 8500000,
      startDate: new Date('2026-01-15'), endDate: new Date('2026-12-31'),
      geofenceLat: 28.5355, geofenceLng: 77.3910, geofenceRadius: 300
    }
  });
  const project2 = await prisma.project.create({
    data: {
      name: 'Sunrise Commercial Complex', description: 'Commercial building with office spaces',
      address: 'MG Road, Gurugram, Haryana', status: 'ACTIVE',
      managerId: pm.id, budget: 15000000,
      startDate: new Date('2026-03-01'), endDate: new Date('2027-06-30'),
      geofenceLat: 28.4595, geofenceLng: 77.0266, geofenceRadius: 500
    }
  });

  console.log('✅ Projects created with geo-fences');

  // ─── TASKS ──────────────────────────────────────────────────────
  const tasks = await Promise.all([
    prisma.task.create({ data: { projectId: project1.id, title: 'Foundation excavation', description: 'Complete excavation for building foundation', status: 'COMPLETED', priority: 'HIGH', assignedToId: engineer1.id, createdById: pm.id, startDate: new Date('2026-01-20'), dueDate: new Date('2026-02-15'), completedAt: new Date('2026-02-12') } }),
    prisma.task.create({ data: { projectId: project1.id, title: 'RCC column work - Ground floor', description: 'Pour concrete for ground floor columns', status: 'IN_PROGRESS', priority: 'HIGH', assignedToId: engineer1.id, createdById: pm.id, startDate: new Date('2026-02-16'), dueDate: new Date('2026-04-01') } }),
    prisma.task.create({ data: { projectId: project1.id, title: 'Plumbing rough-in', description: 'Install rough plumbing before walls are closed', status: 'NOT_STARTED', priority: 'MEDIUM', assignedToId: engineer2.id, createdById: pm.id, dueDate: new Date('2026-04-30') } }),
    prisma.task.create({ data: { projectId: project1.id, title: 'Electrical wiring - Ground floor', description: 'Complete electrical conduit and wiring', status: 'NOT_STARTED', priority: 'MEDIUM', assignedToId: engineer2.id, createdById: pm.id, dueDate: new Date('2026-05-15') } }),
    prisma.task.create({ data: { projectId: project2.id, title: 'Site clearing and leveling', description: 'Clear vegetation and level the site', status: 'COMPLETED', priority: 'HIGH', assignedToId: engineer1.id, createdById: pm.id, completedAt: new Date('2026-03-10') } }),
    prisma.task.create({ data: { projectId: project2.id, title: 'Boundary wall construction', description: 'Build boundary wall around the site', status: 'IN_PROGRESS', priority: 'MEDIUM', assignedToId: engineer2.id, createdById: pm.id, dueDate: new Date('2026-04-15') } }),
  ]);

  console.log('✅ Tasks created');

  // ─── LABOURERS ──────────────────────────────────────────────────
  const labourers = await Promise.all([
    prisma.labourer.create({ data: { name: 'Ram Prasad', phone: '9888800001', tradeType: 'Mason', proposedAmount: 24000, amountPaid: 16000, projectId: project1.id } }),
    prisma.labourer.create({ data: { name: 'Shyam Kumar', phone: '9888800002', tradeType: 'Helper', proposedAmount: 15000, amountPaid: 10000, projectId: project1.id } }),
    prisma.labourer.create({ data: { name: 'Mohan Lal', phone: '9888800003', tradeType: 'Electrician', proposedAmount: 27000, amountPaid: 18000, projectId: project1.id } }),
    prisma.labourer.create({ data: { name: 'Gopal Das', phone: '9888800004', tradeType: 'Plumber', proposedAmount: 25500, amountPaid: 17000, projectId: project1.id } }),
    prisma.labourer.create({ data: { name: 'Dinesh Yadav', phone: '9888800005', tradeType: 'Mason', proposedAmount: 24000, amountPaid: 16000, projectId: project1.id } }),
    prisma.labourer.create({ data: { name: 'Sunil Chauhan', phone: '9888800006', tradeType: 'Helper', proposedAmount: 15000, amountPaid: 9000, projectId: project2.id } }),
    prisma.labourer.create({ data: { name: 'Anil Gupta', phone: '9888800007', tradeType: 'Carpenter', proposedAmount: 27000, amountPaid: 15000, projectId: project2.id } }),
  ]);

  console.log('✅ Labourers created');

  // ─── VENDORS ────────────────────────────────────────────────────
  const vendor1 = await prisma.vendor.create({
    data: { name: 'Shree Cement Traders', phone: '9777700001', address: 'Industrial Area, Noida', gstNumber: 'GST123456789', categories: ['Cement', 'Sand', 'Bricks'], rating: 4.2, paymentTerms: 'Net 30' }
  });
  const vendor2 = await prisma.vendor.create({
    data: { name: 'National Steel Suppliers', phone: '9777700002', address: 'Wazirpur, Delhi', gstNumber: 'GST987654321', categories: ['Steel', 'TMT Bars', 'Binding Wire'], rating: 4.5, paymentTerms: 'Net 15' }
  });
  const vendor3 = await prisma.vendor.create({
    data: { name: 'Gupta Electrical House', phone: '9777700003', address: 'Bhagirath Palace, Delhi', categories: ['Electrical', 'Wires', 'Switches', 'MCBs'], rating: 4.0, paymentTerms: 'Cash' }
  });

  console.log('✅ Vendors created');

  // ─── MATERIAL CATALOG ───────────────────────────────────────────
  const materials = [
    { name: 'OPC Cement 53 Grade', category: 'Cement', unit: 'Bag (50kg)', defaultPrice: 380, brands: ['UltraTech', 'ACC', 'Ambuja', 'Shree'] },
    { name: 'PPC Cement', category: 'Cement', unit: 'Bag (50kg)', defaultPrice: 350, brands: ['UltraTech', 'Birla', 'ACC'] },
    { name: 'TMT Bar 8mm', category: 'Steel', unit: 'Kg', defaultPrice: 65, brands: ['Tata Tiscon', 'SAIL', 'Jindal'] },
    { name: 'TMT Bar 12mm', category: 'Steel', unit: 'Kg', defaultPrice: 62, brands: ['Tata Tiscon', 'SAIL', 'Jindal'] },
    { name: 'River Sand', category: 'Sand', unit: 'CFT', defaultPrice: 55, brands: [] },
    { name: 'M Sand', category: 'Sand', unit: 'CFT', defaultPrice: 45, brands: [] },
    { name: 'Red Bricks', category: 'Bricks', unit: 'Piece', defaultPrice: 8, brands: [] },
    { name: 'AAC Blocks', category: 'Bricks', unit: 'Piece', defaultPrice: 55, brands: ['Magicrete', 'JK Lakshmi'] },
    { name: 'Binding Wire', category: 'Steel', unit: 'Kg', defaultPrice: 80, brands: ['Tata'] },
    { name: 'Electrical Wire 1.5mm', category: 'Electrical', unit: 'Meter', defaultPrice: 18, brands: ['Havells', 'Polycab', 'Finolex'] },
    { name: 'PVC Pipe 3 inch', category: 'Plumbing', unit: 'Piece (10ft)', defaultPrice: 280, brands: ['Astral', 'Supreme', 'Prince'] },
    { name: 'CPVC Pipe 1 inch', category: 'Plumbing', unit: 'Piece (10ft)', defaultPrice: 350, brands: ['Astral', 'Supreme'] },
  ];
  await prisma.materialCatalog.createMany({ data: materials });

  console.log('✅ Material catalog created');

  // ─── SAMPLE PURCHASE ORDERS ─────────────────────────────────────
  const po1 = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-202603-0001', projectId: project1.id, createdById: engineer1.id,
      status: 'CLOSED', urgency: 'NORMAL', vendorId: vendor1.id,
      totalAmount: 45600, approvedById: finance.id, approvedAt: new Date('2026-03-10'),
      items: {
        create: [
          { itemName: 'OPC Cement 53 Grade', itemCategory: 'Cement', quantity: 100, unit: 'Bag', unitPrice: 380, totalPrice: 38000, brand: 'UltraTech' },
          { itemName: 'River Sand', itemCategory: 'Sand', quantity: 100, unit: 'CFT', unitPrice: 55, totalPrice: 5500 },
          { itemName: 'Red Bricks', itemCategory: 'Bricks', quantity: 500, unit: 'Piece', unitPrice: 8, totalPrice: 4000 },
        ]
      }
    }
  });

  const po2 = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-202603-0002', projectId: project1.id, createdById: engineer1.id,
      status: 'VENDOR_ASSIGNED', urgency: 'URGENT', vendorId: vendor2.id,
      totalAmount: 93000, approvedById: finance.id, approvedAt: new Date('2026-03-18'),
      items: {
        create: [
          { itemName: 'TMT Bar 12mm', itemCategory: 'Steel', quantity: 1500, unit: 'Kg', unitPrice: 62, totalPrice: 93000, brand: 'Tata Tiscon' },
        ]
      }
    }
  });

  const po3 = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-202603-0003', projectId: project1.id, createdById: engineer2.id,
      status: 'SUBMITTED', urgency: 'NORMAL',
      items: {
        create: [
          { itemName: 'Electrical Wire 1.5mm', itemCategory: 'Electrical', quantity: 500, unit: 'Meter', unitPrice: 18, totalPrice: 9000 },
          { itemName: 'PVC Pipe 3 inch', itemCategory: 'Plumbing', quantity: 20, unit: 'Piece', unitPrice: 280, totalPrice: 5600 },
        ]
      }
    }
  });

  console.log('✅ Purchase orders created');

  // ─── SAMPLE DELIVERY ────────────────────────────────────────────
  await prisma.delivery.create({
    data: {
      purchaseOrderId: po1.id, deliveryPersonId: delivery.id,
      status: 'VERIFIED', pickupAddress: vendor1.address, dropAddress: project1.address,
      deliveredAt: new Date('2026-03-12'), verifiedById: engineer1.id, verifiedAt: new Date('2026-03-12')
    }
  });

  console.log('✅ Sample delivery created');

  // ─── SAMPLE ATTENDANCE ──────────────────────────────────────────
  const days = [0, 1, 2, 3, 4];
  for (const dayOffset of days) {
    const date = new Date(); date.setDate(date.getDate() - dayOffset); date.setHours(0, 0, 0, 0);
    const punchIn = new Date(date); punchIn.setHours(9, 0, 0);
    const punchOut = new Date(date); punchOut.setHours(18, 0, 0);

    await prisma.attendance.create({
      data: {
        userId: engineer1.id, projectId: project1.id, date,
        punchInTime: punchIn, punchOutTime: dayOffset === 0 ? null : punchOut,
        punchInLat: 28.5355, punchInLng: 77.3910,
        punchOutLat: dayOffset === 0 ? null : 28.5355,
        punchOutLng: dayOffset === 0 ? null : 77.3910,
        isWithinGeofence: true, totalHours: dayOffset === 0 ? null : 9.0
      }
    }).catch(() => {});
  }

  console.log('✅ Sample attendance records created');
  console.log('\n🎉 Seed complete!\n');
  console.log('─── Login Credentials ───');
  console.log('Admin:     admin@construction.com / password123');
  console.log('PM:        pm@construction.com / password123');
  console.log('Engineer:  engineer1@construction.com / password123');
  console.log('Finance:   finance@construction.com / password123');
  console.log('Delivery:  delivery@construction.com / password123');
  console.log('Client:    client@construction.com / password123');
  console.log('Foreman:   foreman@construction.com / password123');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
