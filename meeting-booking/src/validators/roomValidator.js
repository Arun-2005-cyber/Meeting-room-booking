// src/validators/roomValidator.js
const Joi = require('joi');

const create = Joi.object({
  name: Joi.string().min(1).required(),
  capacity: Joi.number().integer().min(1).required(),
  floor: Joi.number().integer().optional(),
  amenities: Joi.array().items(Joi.string()).optional(),
  timezone: Joi.string().optional().default('UTC')
});

module.exports = { create };
