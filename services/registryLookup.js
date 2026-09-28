const axios = require("axios");

const REGISTRY_LOOKUP_URL = process.env.REGISTRY_LOOKUP_URL;

/**
 * Example registry lookup helper.
 * Adjust based on Nexitytec / CORD actual lookup contract.
 */
async function lookupSubscriber(subscriberId, uniqueKeyId) {
  try {
    const url = `${REGISTRY_LOOKUP_URL}/${subscriberId}/${uniqueKeyId}`;
    const response = await axios.get(url);
    return response.data;
  } catch (err) {
    console.error("Registry lookup failed:", err.message);
    throw err;
  }
}

module.exports = {
  lookupSubscriber
};