// src/middleware/errorHandler.js
module.exports = (err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const code = err.code || err.name || 'InternalError';
  res.status(status).json({
    error: code,
    message: err.message || 'Internal server error'
  });
};
