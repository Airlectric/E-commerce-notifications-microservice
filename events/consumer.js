const mongoose = require("mongoose");
const { sendEmail } = require("../config/emailProvider");
const { connectRabbitMQ } = require("../config/rabbitmq");
const User = require("../models/user");

const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_URL });

// Function to fetch the product quantity from Elasticsearch
const getProductQuantityFromES = async (title) => {
  try {
    const response = await esClient.search({
      index: 'microservice_products',
      body: {
        query: {
          match: {
            title: title,
          },
        },
      },
    });

    // Debugging the response structure
    console.log('Elasticsearch Response:', JSON.stringify(response, null, 2));

    // Correct way to access the response data
    const hits = response.hits?.hits || []; // Access hits array safely

    if (hits.length > 0) {
      const product = hits[0]._source; // Extract the first product from hits
      console.log(`Product found: ${product.title}, Quantity: ${product.quantity}`);
      return product.quantity || 0; // Return the product quantity if found
    } else {
      console.log(`Product with title "${title}" not found in Elasticsearch`);
      return 0; // Default to 0 if no product found
    }
  } catch (error) {
    console.error(`Error fetching product from Elasticsearch: ${error.message}`);
    return 0; // Default to 0 if error occurs
  }
};



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

// Authentication events
const handleAuthEvents = async (event) => {
  try {
    console.log("Auth event received:", event);

    const sendRegistrationEmail = async (userDetails) => {
      let subject, message, html;
      if (userDetails.role === "SHOP_OWNER") {
        subject = "Welcome, Shop Owner!";
        message = "Your shop owner account has been successfully created.";
        html = `
          <h1>Welcome to Our Platform, ${userDetails.username}!</h1>
          <p>We're excited to have you as a shop owner. Start managing your shop and serving your customers today!</p>
          <p><strong>Get started now and grow your business with us.</strong></p>
        `;
      } else {
        subject = "Welcome to Our Service!";
        message = "Your account has been successfully created.";
        html = `
          <h1>Hello, ${userDetails.username}!</h1>
          <p>We're thrilled to welcome you to our community. Explore and enjoy our amazing features!</p>
          <p><strong>Your journey begins now. Let’s make it memorable!</strong></p>
        `;
      }
      await sendEmail(userDetails.email, subject, message, html);
    };

    const sendLoginEmail = async (userDetails) => {
      const subject = "Login Alert!";
      const message = "Your account was accessed successfully.";
      const html = `
        <h1>Hello, ${userDetails.username}!</h1>
        <p>We noticed a login to your account just now. If this was you, enjoy your session!</p>
        <p><strong>Secure your account and always stay vigilant.</strong></p>
      `;
      await sendEmail(userDetails.email, subject, message, html);
    };

    const sendLogoutEmail = async (userDetails) => {
      const subject = "Goodbye for Now!";
      const message = "You have logged out successfully.";
      const html = `
        <h1>Goodbye, ${userDetails.username}!</h1>
        <p>You’ve logged out from your account. We’ll be here when you return!</p>
        <p><strong>Stay safe and come back soon!</strong></p>
      `;
      await sendEmail(userDetails.email, subject, message, html);
    };

    if (event.type === "user_created") {
      const userDetails = await fetchUserDetails(event.data.userId);
      if (userDetails) {
		console.log(userDetails);
        await sendRegistrationEmail(userDetails);
      }
    }

    if (event.type === "user_logged_in") {
      const userDetails = await fetchUserDetails(event.data.userId);
      if (userDetails) {
        console.log(`User ${userDetails.username} logged in.`);
        await sendLoginEmail(userDetails);
      }
    }

    if (event.type === "user_logged_out") {
      const userDetails = await fetchUserDetails(event.data.userId);
      if (userDetails) {
        console.log(`User ${userDetails.username} logged out.`);
        await sendLogoutEmail(userDetails);
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
          
          // Fetch the remaining quantity from Elasticsearch for the particular product
          const remainingQuantity = await getProductQuantityFromES(event.data.titles[index]);

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
          
          // Fetch the remaining quantity from Elasticsearch for the particular product
          const remainingQuantity = await getProductQuantityFromES(event.data.titles[index]);

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
		  console.log('seller id', Number(sellerId))
          const sellerDetails = await fetchUserDetails(Number(sellerId));
          
          // Fetch the remaining quantity from Elasticsearch for the particular product
          const remainingQuantity = await getProductQuantityFromES(event.data.titles[index]);

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
