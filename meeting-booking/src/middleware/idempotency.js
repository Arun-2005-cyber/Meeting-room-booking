// src/middleware/idempotency.js
module.exports = {
  capture: (req, res, next) => {
    const key = req.header('Idempotency-Key');
    if (key) {
      req.idempotency = { key };
    } else {
      req.idempotency = null;
    }
    next();
  }
};
