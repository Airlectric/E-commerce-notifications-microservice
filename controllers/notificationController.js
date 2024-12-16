const Notification = require("../models/notificationModel");

exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id; // Assuming authentication middleware
    const notifications = await Notification.find({ userId }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
