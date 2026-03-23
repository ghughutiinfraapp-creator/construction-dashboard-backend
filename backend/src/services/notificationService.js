const prisma = require('../config/database');

class NotificationService {
  constructor(io) {
    this.io = io;
  }

  async send({ userId, title, body, type, entityType, entityId }) {
    // Save to database
    const notification = await prisma.notification.create({
      data: { userId, title, body, type, entityType, entityId }
    });

    // Send via Socket.io (real-time)
    if (this.io) {
      this.io.to(`user-${userId}`).emit('notification', notification);
    }

    // TODO: Send push notification via Firebase FCM
    // const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
    // if (user?.fcmToken) { await sendFCMPush(user.fcmToken, title, body); }

    return notification;
  }

  async sendToRole({ role, title, body, type, entityType, entityId }) {
    const users = await prisma.user.findMany({ where: { role, isActive: true }, select: { id: true } });
    const notifications = await Promise.all(
      users.map(user => this.send({ userId: user.id, title, body, type, entityType, entityId }))
    );
    return notifications;
  }

  async sendToMultiple({ userIds, title, body, type, entityType, entityId }) {
    const notifications = await Promise.all(
      userIds.map(userId => this.send({ userId, title, body, type, entityType, entityId }))
    );
    return notifications;
  }
}

module.exports = NotificationService;
