const mongoose = require("mongoose");
const { sendEmail } = require("../config/emailProvider");
const { connectRabbitMQ } = require("../config/rabbitmq");
const User = require("../models/user"); // MongoDB User model

let channel;

const initConsumer = async () => {
  try {
    // Connect to RabbitMQ
    channel = await connectRabbitMQ();

    // Assert required queues
    const queues = [
      "product_events_for_notifications",
      "order_events_for_notifications",
      "auth_events",
      "user_data_sync", // New queue for user data synchronization
    ];
    await Promise.all(queues.map(queue => channel.assertQueue(queue, { durable: true })));

    // Consume events from the respective queues
    consumeQueue("product_events_for_notifications", handleProductEvents);
    consumeQueue("order_events_for_notifications", handleOrderEvents);
    consumeQueue("auth_events", handleAuthEvents);
    consumeQueue("user_data_sync", syncUserData);
  } catch (error) {
    console.error("Error initializing RabbitMQ consumer:", error.message);
  }
};

// Synchronize user data with MongoDB
const syncUserData = async (event) => {
  try {
    const { id, username, email, role } = event;
    const update = { username, email, role };

    await User.findOneAndUpdate({ id }, update, { upsert: true });
    console.log(`User data synced: ${id}`);
  } catch (error) {
    console.error("Error syncing user data:", error.message);
  }
};

// Utility to consume a queue
const consumeQueue = (queue, handler) => {
  channel.consume(queue, async (msg) => {
    const event = JSON.parse(msg.content.toString());
    console.log(`Received event from ${queue}:`, event);

    try {
      await handler(event);
      channel.ack(msg);
    } catch (error) {
      console.error(`Error handling event from ${queue}:`, error.message);
      channel.nack(msg, false, false);
    }
  });
};

// Fetch user details from MongoDB
const fetchUserDetails = async (userId) => {
  try {
    const user = await User.findOne({ id: userId }).exec();
    if (!user) throw new Error(`User with ID ${userId} not found`);
    return user;
  } catch (error) {
    console.error("Failed to fetch user details:", error.message);
    return null;
  }
};

// Auth Event handler
const handleAuthEvents = async (event) => {
  try {
    console.log("Auth event received:", event);

    if (event.type === "user_created") {
      const userDetails = await fetchUserDetails(event.data.userId);
      if (userDetails) {
        await sendEmail(
          userDetails.email,
          "Welcome to Our Service",
          "Your account has been successfully created.",
          "<p>Your account has been created, welcome to our service!</p>"
        );
      }
    }
  } catch (error) {
    console.error("Error handling auth event:", error.message);
  }
};

// Product Event handler
const handleProductEvents = async (event) => {
  try {
    if (event.type === "product_created") {
      const { title, description, price, quantity, seller, createdAt } = event.data;

      const sellerDetails = await fetchUserDetails(seller.id);
      if (sellerDetails) {
        const formattedDate = new Date(createdAt).toLocaleDateString();
        const messageBody = `
          <p>Hi ${sellerDetails.username},</p>
          <p>Your new product has been created successfully:</p>
          <ul>
            <li><b>Title:</b> ${title}</li>
            <li><b>Description:</b> ${description}</li>
            <li><b>Price:</b> $${price}</li>
            <li><b>Quantity:</b> ${quantity}</li>
          </ul>
          <p>Created on: ${formattedDate}</p>
        `;
        await sendEmail(
          sellerDetails.email,
          "Product Created Successfully",
          `Your product "${title}" has been successfully created!`,
          messageBody
        );
      }
    }

    if (event.type === "product_updated") {
      const { title, description, price, quantity, category, seller } = event.data;

      const sellerDetails = await fetchUserDetails(seller.id);
      if (sellerDetails) {
        const messageBody = `
          <p>Hi ${sellerDetails.username},</p>
          <p>Your product has been updated successfully with the following details:</p>
          <ul>
            <li><b>Title:</b> ${title}</li>
            <li><b>Description:</b> ${description}</li>
            <li><b>Category:</b> ${category}</li>
            <li><b>Price:</b> $${price}</li>
            <li><b>Current Quantity:</b> ${quantity}</li>
          </ul>
          <p>If you didn’t request this update, please contact our support team immediately.</p>
          <p>Thank you for keeping your products up to date!</p>
        `;
        await sendEmail(
          sellerDetails.email,
          "Product Updated Successfully",
          `Your product "${title}" has been successfully updated!`,
          messageBody
        );
      }
    }

    if (event.type === "product_deleted") {
      const { title, description, category, price, seller, quantity } = event.data;

      const sellerDetails = await fetchUserDetails(seller.id);
      if (sellerDetails) {
        const messageBody = `
          <p>Hi ${sellerDetails.username},</p>
          <p>We have processed your request to delete the following product:</p>
          <ul>
            <li><b>Title:</b> ${title}</li>
            <li><b>Description:</b> ${description}</li>
            <li><b>Category:</b> ${category}</li>
            <li><b>Price:</b> $${price}</li>
            <li><b>Remaining Quantity Before Deletion:</b> ${quantity}</li>
          </ul>
          <p>Your product has been successfully removed from our platform.</p>
          <p>If you deleted this by mistake or need assistance, feel free to contact us at <a href="mailto:support@example.com">support@example.com</a>.</p>
          <p>Warm regards,</p>
          <p><b>Your Product Team</b></p>
        `;
        await sendEmail(
          sellerDetails.email,
          "Product Deleted Successfully",
          `Your product "${title}" has been successfully deleted.`,
          messageBody
        );
      }
    }
  } catch (error) {
    console.error("Error handling product event:", error.message);
  }
};



// Order Event handler
const handleOrderEvents = async (event) => {
  try {
    switch (event.type) {
      case "order_placed": {
        const userDetailsPromise = fetchUserDetails(event.data.userId);

        const sellerPromises = event.data.sellerIds.map(async (sellerId, index) => {
          const sellerDetails = await fetchUserDetails(sellerId);
          const remainingQuantity = event.data.remainingQuantities.find(
            (product) => product.productId === event.data.productIds[index]
          )?.remainingQuantity;

          if (sellerDetails) {
            const sellerMessage = `
              <p style="font-family: Arial, sans-serif; color: #333;">
                Hi <b>${sellerDetails.username}</b>,
              </p>
              <p>A new order has been placed for your product:</p>
              <ul style="list-style-type: none; padding: 0;">
                <li><b>Product:</b> ${event.data.titles[index]}</li>
                <li><b>Quantity Ordered:</b> ${event.data.quantities[index]}</li>
                <li><b>Remaining Stock:</b> ${remainingQuantity || "Unknown"}</li>
              </ul>
              <p>Please prepare the order promptly. Thank you!</p>
            `;
            await sendEmail(
              sellerDetails.email,
              "New Order Received",
              `A new order has been placed for "${event.data.titles[index]}"`,
              sellerMessage
            );
          }
        });

        await Promise.all(sellerPromises);

        const userDetails = await userDetailsPromise;
        if (userDetails) {
          const productList = event.data.titles.map((title, index) => {
            return `<li>${title} (Quantity: ${event.data.quantities[index]})</li>`;
          }).join("");

          const userMessage = `
            <p style="font-family: Arial, sans-serif; color: #333;">
              Hi <b>${userDetails.username}</b>,
            </p>
            <p>Your order has been successfully placed:</p>
            <ul>${productList}</ul>
            <p>Thank you for shopping with us!</p>
          `;
          await sendEmail(
            userDetails.email,
            "Order Placed",
            `Your order for "${event.data.titles.join(", ")}" has been placed successfully.`,
            userMessage
          );
        }

        break;
      }

      case "order_updated": {
        const userDetailsPromise = fetchUserDetails(event.data.userId);

        const sellerPromises = event.data.sellerIds.map(async (sellerId, index) => {
          const sellerDetails = await fetchUserDetails(sellerId);
          const remainingQuantity = event.data.remainingQuantities.find(
            (product) => product.productId === event.data.productIds[index]
          )?.remainingQuantity;

          if (sellerDetails) {
            const sellerMessage = `
              <p style="font-family: Arial, sans-serif; color: #333;">
                Hi <b>${sellerDetails.username}</b>,
              </p>
              <p>The order for your product has been updated:</p>
              <ul style="list-style-type: none; padding: 0;">
                <li><b>Product:</b> ${event.data.titles[index]}</li>
                <li><b>Updated Quantity:</b> ${event.data.quantities[index]}</li>
                <li><b>Remaining Stock:</b> ${remainingQuantity || "Unknown"}</li>
              </ul>
              <p>Keep track of your stock levels and fulfill this updated order. Thank you!</p>
            `;
            await sendEmail(
              sellerDetails.email,
              "Order Updated",
              `The order for "${event.data.titles[index]}" has been updated`,
              sellerMessage
            );
          }
        });

        await Promise.all(sellerPromises);

        const userDetails = await userDetailsPromise;
        if (userDetails) {
          const productList = event.data.titles.map((title, index) => {
            return `<li>${title} (Updated Quantity: ${event.data.quantities[index]})</li>`;
          }).join("");

          const userMessage = `
            <p style="font-family: Arial, sans-serif; color: #333;">
              Hi <b>${userDetails.username}</b>,
            </p>
            <p>Your order has been updated:</p>
            <ul>${productList}</ul>
            <p>Thank you for your continued support!</p>
          `;
          await sendEmail(
            userDetails.email,
            "Order Updated",
            `Your order for "${event.data.titles.join(", ")}" has been updated.`,
            userMessage
          );
        }

        break;
      }

      case "order_deleted": {
        const userDetailsPromise = fetchUserDetails(event.data.userId);

        const sellerPromises = event.data.sellerIds.map(async (sellerId, index) => {
          const sellerDetails = await fetchUserDetails(sellerId);
          const remainingQuantity = event.data.remainingQuantities[index];

          if (sellerDetails) {
            const sellerMessage = `
              <p style="font-family: Arial, sans-serif; color: #333;">
                Hi <b>${sellerDetails.username}</b>,
              </p>
              <p>An order for your product has been cancelled:</p>
              <ul style="list-style-type: none; padding: 0;">
                <li><b>Product:</b> ${event.data.titles[index]}</li>
                <li><b>Cancelled Quantity:</b> ${event.data.quantities[index]}</li>
                <li><b>Remaining Stock:</b> ${remainingQuantity || "Unknown"}</li>
              </ul>
              <p>We regret the cancellation but trust you'll continue providing great service!</p>
            `;
            await sendEmail(
              sellerDetails.email,
              "Order Cancelled",
              `The order for "${event.data.titles[index]}" has been cancelled.`,
              sellerMessage
            );
          }
        });

        await Promise.all(sellerPromises);

        const userDetails = await userDetailsPromise;
        if (userDetails) {
          const productList = event.data.titles.map((title, index) => {
            return `<li>${title} (Cancelled Quantity: ${event.data.quantities[index]})</li>`;
          }).join("");

          const userMessage = `
            <p style="font-family: Arial, sans-serif; color: #333;">
              Hi <b>${userDetails.username}</b>,
            </p>
            <p>Your order has been cancelled:</p>
            <ul>${productList}</ul>
            <p>We’re sorry for any inconvenience caused.</p>
          `;
          await sendEmail(
            userDetails.email,
            "Order Cancelled",
            `Your order for "${event.data.titles.join(", ")}" has been cancelled.`,
            userMessage
          );
        }

        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
        break;
    }
  } catch (error) {
    console.error("Error handling order event:", error.message);
  }
};





// Initialize the consumer service
initConsumer();

module.exports = { initConsumer };
