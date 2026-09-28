require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`BAP server running on port ${PORT}`);
});