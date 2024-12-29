//notifications microservice rabbit mq
const amqp = require("amqplib");

let connection, channel;

const connectRabbitMQ = async () => {
  if (!connection) {
    try {
      connection = await amqp.connect(process.env.RABBITMQ_URI);
      channel = await connection.createChannel();
      console.log("Connected to RabbitMQ");
    } catch (err) {
      console.error("Failed to connect to RabbitMQ:", err.message);
      throw err;
    }
  }
  return channel;
};

const sendMessage = (queue, message) => {
  if (!channel) throw new Error("RabbitMQ channel is not initialized");
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
};

const assertQueues = async (queues) => {
  if (channel) {
    for (const queue of queues) {
      await channel.assertQueue(queue, { durable: true });
    }
  }
};

module.exports = { connectRabbitMQ, sendMessage, assertQueues };
