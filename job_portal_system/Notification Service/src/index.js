
const express = require('express');
const amqp    = require('amqplib');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3004;
app.use(express.json());

// ── In-memory notification store ──────────────────────────────────────────────
// Stored as { userId: [ { id, message, read, createdAt } ] }
const notifications = {};

function addNotification(userId, message) {
  if (!notifications[userId]) notifications[userId] = [];
  notifications[userId].unshift({
    id:        Date.now(),
    message,
    read:      false,
    createdAt: new Date().toISOString()
  });
  // Keep max 50 notifications per user
  if (notifications[userId].length > 50)
    notifications[userId] = notifications[userId].slice(0, 50);

  console.log(`🔔 Notification stored for user ${userId}: ${message}`);
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

// ── GET /notifications/:userId — fetch notifications for a user ───────────────
app.get('/notifications/:userId', (req, res) => {
  const list = notifications[req.params.userId] || [];
  const unread = list.filter(n => !n.read).length;
  res.json({ notifications: list, unread });
});

// ── PATCH /notifications/:userId/read — mark all as read ─────────────────────
app.patch('/notifications/:userId/read', (req, res) => {
  if (notifications[req.params.userId]) {
    notifications[req.params.userId].forEach(n => n.read = true);
  }
  res.json({ message: 'All notifications marked as read' });
});

// ── DELETE /notifications/:userId — clear all notifications ──────────────────
app.delete('/notifications/:userId', (req, res) => {
  notifications[req.params.userId] = [];
  res.json({ message: 'Notifications cleared' });
});

app.listen(PORT, () => {
  console.log(`[notification-service] running on port ${PORT}`);
});

// ── RabbitMQ consumer ─────────────────────────────────────────────────────────
const EXCHANGE = 'job_portal';
const QUEUE    = 'notification_queue';

async function startConsumer() {
  try {
    const conn    = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672');
    const channel = await conn.createChannel();

    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue(QUEUE, { durable: true });
    await channel.bindQueue(QUEUE, EXCHANGE, 'application.submitted');
    await channel.bindQueue(QUEUE, EXCHANGE, 'application.updated');

    channel.prefetch(1);
    console.log('✅ Connected to RabbitMQ — waiting for events...');

    channel.consume(QUEUE, (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      const payload    = JSON.parse(msg.content.toString());

      console.log(`📩 Event received: ${routingKey}`);

      if (routingKey === 'application.submitted') {
        // Notify the seeker their application was received
        addNotification(
          String(payload.seeker_id),
          `✅ Your application for "${payload.job_title}" at ${payload.company} has been received.`
        );
      }

      if (routingKey === 'application.updated') {
        // Notify the seeker their status changed
        const messages = {
          reviewed: `👀 Your application for "${payload.job_title}" is being reviewed.`,
          accepted: `🎉 Congratulations! Your application for "${payload.job_title}" was accepted!`,
          rejected: `❌ Your application for "${payload.job_title}" was not selected this time.`
        };
        addNotification(
          String(payload.seeker_id),
          messages[payload.new_status] || `Your application status changed to: ${payload.new_status}`
        );
      }

      channel.ack(msg);
    });

    conn.on('error', () => setTimeout(startConsumer, 5000));

  } catch (err) {
    console.error('❌ RabbitMQ connection failed:', err.message);
    setTimeout(startConsumer, 5000);
  }
}

startConsumer();
