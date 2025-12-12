// src/utils/timeUtils.js
const { DateTime } = require('luxon');

function toISO(t) {
  return DateTime.fromJSDate(t).toISO();
}

module.exports = { toISO };
