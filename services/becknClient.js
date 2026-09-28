const axios = require("axios");
const { createAuthorizationHeader } = require("./becknAuth");

const BECKN_GATEWAY_URL = process.env.BECKN_GATEWAY_URL;

async function sendSearch(payload) {
  const auth = createAuthorizationHeader(payload, 300);

  const headers = {
    "Content-Type": "application/json",
    "Authorization": auth.authorization
  };

  const response = await axios.post(BECKN_GATEWAY_URL, payload, { headers });

  return {
    requestHeaders: headers,
    signingMeta: auth,
    data: response.data
  };
}

module.exports = {
  sendSearch
};