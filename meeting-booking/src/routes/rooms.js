// src/routes/rooms.js
const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');

router.post('/', roomController.createRoom);
router.get('/', roomController.listRooms);

module.exports = router;
