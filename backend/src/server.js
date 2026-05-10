require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const projectRoutes = require('./routes/projects');
const attendanceRoutes = require('./routes/attendance');
const taskRoutes = require('./routes/tasks');
const labourRoutes = require('./routes/labour');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const deliveryRoutes = require('./routes/deliveries');
const vendorRoutes = require('./routes/vendors');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');
const uploadRoutes = require('./routes/uploads');
const materialRoutes = require('./routes/materials');
const foremanRoutes= require('./routes/foreman');
const issueRoutes = require('./routes/issues');
const suggestionRoutes = require('./routes/suggestions');

const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL,
      process.env.MOBILE_URL,
      'http://localhost:3000',
      'http://localhost:8081',
      'http://10.0.2.2:8081',
      'https://construction-dashboard-frontend.vercel.app'
      
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  }
});

// Make io accessible in routes
app.set('io', io);

// Middleware
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    process.env.MOBILE_URL,
    'http://localhost:3000',
    'http://localhost:8081',
    'http://10.0.2.2:8081',
    'https://construction-dashboard-frontend.vercel.app',
  ],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/labour', labourRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/foreman',foremanRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/suggestions', suggestionRoutes);


// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Join a user-specific room for targeted notifications
  socket.on('join-user', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`${socket.id} joined user room: user-${userId}`);
  });

  // Join a project room for project-level updates
  socket.on('join-room', (room) => {
    socket.join(room);
    console.log(`${socket.id} joined room: ${room}`);
  });

  socket.on('leave-room', (room) => {
    socket.leave(room);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Error handler (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🏗️  Construction Platform API running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { app, server, io };
