// src/routes/bookings.js
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const idempotencyMiddleware = require('../middleware/idempotency');

// create booking (idempotency header optional)
router.post('/', idempotencyMiddleware.capture, bookingController.createBooking);
router.get('/', bookingController.listBookings);
router.post('/:id/cancel', bookingController.cancelBooking);

// report: room utilization
router.get('/reports/room-utilization', bookingController.roomUtilization);

module.exports = router;
