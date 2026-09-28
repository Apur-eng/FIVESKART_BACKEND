const express = require("express");
const becknRoutes = require("./routes/beckn.routes");

const app = express();

app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => {
  res.json({ success: true, message: "BAP server is running" });
});

app.use("/", becknRoutes);

module.exports = app;