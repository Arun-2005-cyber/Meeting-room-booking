// src/controllers/roomController.js
const roomService = require('../services/roomService');
const roomValidator = require('../validators/roomValidator');

exports.createRoom = async (req, res, next) => {
  try {
    const payload = await roomValidator.create.validateAsync(req.body);
    const room = await roomService.createRoom(payload);
    res.status(201).json(room);
  } catch (err) {
    next(err);
  }
};

exports.listRooms = async (req, res, next) => {
  try {
    const { minCapacity, amenity } = req.query;
    const rooms = await roomService.listRooms({ minCapacity, amenity });
    res.json(rooms);
  } catch (err) {
    next(err);
  }
};
