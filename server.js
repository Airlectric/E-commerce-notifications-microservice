require("dotenv").config();
const mongoose = require("mongoose");
const { initConsumer } = require("./events/consumer");
const express = require("express");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();
app.use(express.json());

// Async function to initialize the server
async function startServer() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Initialize RabbitMQ Consumers
    await initConsumer();
    console.log("RabbitMQ consumer initialized");

    // Routes
    app.use("/notifications", notificationRoutes);

    // Alive check route
    app.get('/alive', (req, res) => {
      res.status(200).json({ message: 'Notifications service is alive' });
    });

    const PORT = process.env.PORT || 7000;
    app.listen(PORT, () => {
      console.log(`Notification microservice running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start the server:", err.message);
    process.exit(1); 
  }
}

startServer();
