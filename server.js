require("dotenv").config();
const mongoose = require("mongoose");
const { initConsumer } = require("./events/consumer");
const express = require("express");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Failed to connect to MongoDB:", err.message));

// Routes
app.use("/notifications", notificationRoutes);

// Initialize RabbitMQ Consumers
initConsumer();

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Notification microservice running on port ${PORT}`);
});
