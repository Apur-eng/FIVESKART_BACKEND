const express = require("express");
const router = express.Router();
const becknController = require("../controllers/beckn.controller");

// Outgoing search call
router.post("/search", becknController.search);

// Beckn callback endpoints
router.post("/on_search", becknController.onSearch);
router.post("/on_select", becknController.onSelect);
router.post("/on_init", becknController.onInit);
router.post("/on_confirm", becknController.onConfirm);
router.post("/on_status", becknController.onStatus);

module.exports = router;