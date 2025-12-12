// src/services/roomService.js
const db = require('../db');
const { toLowerCase } = require('../utils/stringUtils');

async function createRoom({ name, capacity, floor, amenities = [], timezone }) {
  // enforce case-insensitive uniqueness: check existing room names lowercased
  const existing = await db.query('SELECT id FROM rooms WHERE LOWER(name) = $1', [name.toLowerCase()]);
  if (existing.rows.length) {
    const err = new Error('Room name must be unique (case-insensitive)');
    err.status = 400;
    throw err;
  }
  const result = await db.query(
    `INSERT INTO rooms (name, capacity, floor, amenities, timezone) 
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, capacity, floor, amenities, timezone || 'UTC']
  );
  return result.rows[0];
}

async function listRooms({ minCapacity, amenity }) {
  const clauses = [];
  const params = [];
  if (minCapacity) {
    params.push(Number(minCapacity));
    clauses.push(`capacity >= $${params.length}`);
  }
  if (amenity) {
    params.push(amenity);
    clauses.push(`$${params.length} = ANY(amenities)`);
  }
  const sql = `SELECT * FROM rooms ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY id`;
  const res = await db.query(sql, params);
  return res.rows;
}

module.exports = {
  createRoom,
  listRooms
};
