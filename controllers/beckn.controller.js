const crypto = require('crypto');
const { sendSearch } = require("../services/becknClient");

function buildSearchPayload(input = {}) {
  const now = new Date().toISOString();

  return {
    context: {
      domain: input.domain || "nic2004:60232", // replace with actual EV domain if your network uses a different code
      country: "IND",
      city: input.city || "std:0522", // example Lucknow code; replace with network-expected city code
      action: "search",
      core_version: "1.1.0",
      bap_id: process.env.BAP_SUBSCRIBER_ID,
      bap_uri: `${process.env.BAP_BASE_URL}/beckn`,
      transaction_id: crypto.randomUUID(),
      message_id: crypto.randomUUID(),
      timestamp: now,
      ttl: "PT30S"
    },
    message: {
      intent: {
        fulfillment: {
          type: "Delivery"
        },
        category: {
          descriptor: {
            code: "EV_CHARGING"
          }
        },
        payment: {
          type: "ON-FULFILLMENT"
        }
      }
    }
  };
}

exports.search = async (req, res) => {
  try {
    const payload = buildSearchPayload(req.body || {});
    const result = await sendSearch(payload);

    return res.json({
      success: true,
      message: "Beckn search sent successfully",
      payload,
      authorization: result.requestHeaders.Authorization,
      gatewayResponse: result.data
    });
  } catch (error) {
    console.error("Search error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send Beckn search",
      error: error.response?.data || error.message
    });
  }
};

exports.onSearch = async (req, res) => {
  try {
    console.log("Received /on_search callback");
    console.dir(req.body, { depth: null });

    // TODO:
    // 1. verify signature if needed
    // 2. save providers/items/quotes into DB
    // 3. map to your 2ChargeEV charger list response

    return res.json({
      message: {
        ack: {
          status: "ACK"
        }
      }
    });
  } catch (error) {
    console.error("onSearch error:", error);
    return res.status(500).json({
      message: {
        ack: {
          status: "NACK"
        }
      },
      error: {
        message: error.message
      }
    });
  }
};

exports.onSelect = async (req, res) => {
  console.log("Received /on_select");
  console.dir(req.body, { depth: null });

  return res.json({
    message: { ack: { status: "ACK" } }
  });
};

exports.onInit = async (req, res) => {
  console.log("Received /on_init");
  console.dir(req.body, { depth: null });

  return res.json({
    message: { ack: { status: "ACK" } }
  });
};

exports.onConfirm = async (req, res) => {
  console.log("Received /on_confirm");
  console.dir(req.body, { depth: null });

  return res.json({
    message: { ack: { status: "ACK" } }
  });
};

exports.onStatus = async (req, res) => {
  console.log("Received /on_status");
  console.dir(req.body, { depth: null });

  return res.json({
    message: { ack: { status: "ACK" } }
  });
};