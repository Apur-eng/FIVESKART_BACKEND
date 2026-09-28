const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const blake = require("blakejs");

const BAP_SUBSCRIBER_ID = process.env.BAP_SUBSCRIBER_ID;
const BAP_UNIQUE_KEY_ID = process.env.BAP_UNIQUE_KEY_ID;

function getPrivateKeyObject() {
  const rawPath = process.env.BAP_PRIVATE_KEY_PATH;

  if (!rawPath) {
    throw new Error("BAP_PRIVATE_KEY_PATH is missing in .env");
  }

  const keyPath = path.resolve(process.cwd(), rawPath);
  console.log("Loading private key from:", keyPath);

  if (!fs.existsSync(keyPath)) {
    throw new Error(`Private key file not found at ${keyPath}`);
  }

  const pem = fs.readFileSync(keyPath, "utf8");

  if (!pem || !pem.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Private key file is empty or invalid");
  }

  // Convert PEM into KeyObject
  return crypto.createPrivateKey({
    key: pem,
    format: "pem",
  });
}

function stableStringify(obj) {
  return JSON.stringify(obj);
}

function createBlake512Digest(payload) {
  const body = typeof payload === "string" ? payload : stableStringify(payload);
  const hashBytes = blake.blake2b(body, null, 64);
  const digestBase64 = Buffer.from(hashBytes).toString("base64");
  return `BLAKE-512=${digestBase64}`;
}

function createSigningString({ created, expires, digest }) {
  return `(created): ${created}\n(expires): ${expires}\ndigest: ${digest}`;
}

function createAuthorizationHeader(payload, ttlSeconds = 300) {
  const privateKey = getPrivateKeyObject();

  const created = Math.floor(Date.now() / 1000);
  const expires = created + ttlSeconds;
  const digest = createBlake512Digest(payload);

  const signingString = createSigningString({
    created,
    expires,
    digest
  });

  // For Ed25519 use algorithm = null
  const signature = crypto.sign(
    null,
    Buffer.from(signingString, "utf8"),
    privateKey
  );

  const signatureBase64 = signature.toString("base64");

  const header =
    `Signature ` +
    `keyId="${BAP_SUBSCRIBER_ID}|${BAP_UNIQUE_KEY_ID}|ed25519",` +
    `algorithm="ed25519",` +
    `created="${created}",` +
    `expires="${expires}",` +
    `headers="(created) (expires) digest",` +
    `signature="${signatureBase64}"`;

  return {
    authorization: header,
    digest,
    created,
    expires,
    signingString
  };
}

module.exports = {
  createAuthorizationHeader
};