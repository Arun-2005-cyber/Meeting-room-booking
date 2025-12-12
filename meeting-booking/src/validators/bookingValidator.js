// src/validators/bookingValidator.js
const Joi = require('joi');

const create = Joi.object({
  roomId: Joi.number().integer().required()
    .messages({ 'any.required': '"roomId" is required' }),

  title: Joi.string().min(1).required()
    .messages({ 'any.required': '"title" is required' }),

  organizerEmail: Joi.string().email().required()
    .messages({ 
      'any.required': '"organizerEmail" is required',
      'string.email': '"organizerEmail" must be a valid email'
    }),

  // Allow ANY time string (luxon will parse later)
  startTime: Joi.string().min(1).required()
    .messages({ 'any.required': '"startTime" is required' }),

  endTime: Joi.string().min(1).required()
    .messages({ 'any.required': '"endTime" is required' }),

  status: Joi.string().valid('confirmed', 'cancelled').default('confirmed'),

  idempotencyKey: Joi.string().optional()
});

module.exports = { create };
