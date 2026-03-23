const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/users/by-role/:role  ← MUST be before /:id to avoid route conflict
router.get('/by-role/:role', authenticate, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: req.params.role, isActive: true },
      select: { id: true, name: true, email: true, phone: true, role: true, avatar: true },
      orderBy: { name: 'asc' }
    });
    res.json({ users });
  } catch (error) { next(error); }
});

// GET /api/users
router.get('/', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { role, search, isActive, page = 1, limit = 20 } = req.query;
    const where = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    else where.isActive = true;
    if (role) where.role = role;
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } }
    ];

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * parseInt(limit),
        take: parseInt(limit),
        select: { id: true, name: true, email: true, phone: true, role: true, avatar: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);
    res.json({ users, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// GET /api/users/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, phone: true, role: true, avatar: true, isActive: true, createdAt: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) { next(error); }
});

// PUT /api/users/:id
router.put('/:id', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { name, email, phone, role, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (role !== undefined) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true }
    });
    res.json({ user });
  } catch (error) { next(error); }
});

// PUT /api/users/:id/reset-password
router.put('/:id/reset-password', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 12);
    await prisma.user.update({ where: { id: req.params.id }, data: { password: hashedPassword } });
    res.json({ message: 'Password reset successfully' });
  } catch (error) { next(error); }
});

module.exports = router;
