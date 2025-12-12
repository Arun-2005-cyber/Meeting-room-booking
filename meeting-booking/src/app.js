// src/app.js
const express = require('express');
const bodyParser = require('body-parser');
const roomsRouter = require('./routes/rooms');
const bookingsRouter = require('./routes/bookings');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.use(bodyParser.json());

app.use('/rooms', roomsRouter);
app.use('/bookings', bookingsRouter);
app.use('/reports', bookingsRouter); // reports route lives in bookingsRouter.report route

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
