// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();

// Importing the controller that handles the notifications
const { getNotifications } = require('../controllers/notificationController');

// Route to get notifications for the logged-in user
router.get('/notifications', getNotifications);

module.exports = router;
