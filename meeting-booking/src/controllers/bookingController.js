// src/controllers/bookingController.js
const bookingService = require('../services/bookingService');
const bookingValidator = require('../validators/bookingValidator');

exports.createBooking = async (req, res, next) => {
  try {
    const payload = await bookingValidator.create.validateAsync(req.body);
    // idempotency middleware will attach req.idempotency if provided
    const booking = await bookingService.createBooking(payload, req.idempotency);
    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
};

exports.listBookings = async (req, res, next) => {
  try {
    const { roomId, from, to, limit = 20, offset = 0 } = req.query;
    const result = await bookingService.listBookings({
      roomId, from, to, limit: Number(limit), offset: Number(offset)
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.cancelBooking = async (req, res, next) => {
  try {
    const id = req.params.id;
    const booking = await bookingService.cancelBooking(id);
    res.json(booking);
  } catch (err) {
    next(err);
  }
};

exports.roomUtilization = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const report = await bookingService.roomUtilization({ from, to });
    res.json(report);
  } catch (err) {
    next(err);
  }
};
