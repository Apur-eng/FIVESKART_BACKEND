const fs = require("fs");
const crypto = require("crypto");

const pem = fs.readFileSync("./keys/beckn_private_key.pem", "utf8");
console.log(pem);

const keyObj = crypto.createPrivateKey({
  key: pem,
  format: "pem",
});

console.log("Private key loaded successfully");
console.log(keyObj.asymmetricKeyType);