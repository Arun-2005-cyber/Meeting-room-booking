// tests/integration/bookings.int.test.js
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');

beforeAll(async () => {
  // ensure DB is clean / migrations applied in test setup outside of jest (or run SQL here)
});

afterAll(async () => {
  await db.pool.end();
});

describe('POST /bookings integration', () => {
  let roomId;
  beforeAll(async () => {
    const r = await db.query(`INSERT INTO rooms (name, capacity, timezone) VALUES ($1,$2,$3) RETURNING *`, ['Test Room', 5, 'UTC']);
    roomId = r.rows[0].id;
  });

  test('create booking happy path', async () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + ((8 - start.getUTCDay() + 7) % 7)); // ensure next weekday
    start.setUTCHours(9,0,0,0);
    const end = new Date(start.getTime() + 30 * 60000);
    const res = await request(app).post('/bookings').send({
      roomId,
      title: 'Test meeting',
      organizerEmail: 'a@example.com',
      startTime: start.toISOString(),
      endTime: end.toISOString()
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  test('overlap conflict returns 409', async () => {
    // create base booking
    const s = new Date();
    s.setUTCDate(s.getUTCDate() + ((8 - s.getUTCDay() + 7) % 7));
    s.setUTCHours(10, 0, 0, 0);
    const e = new Date(s.getTime() + 60*60000);
    await request(app).post('/bookings').send({
      roomId,
      title: 'Existing',
      organizerEmail: 'b@example.com',
      startTime: s.toISOString(),
      endTime: e.toISOString()
    });

    // overlapping booking
    const res = await request(app).post('/bookings').send({
      roomId,
      title: 'Overlap',
      organizerEmail: 'c@example.com',
      startTime: new Date(s.getTime() + 15*60000).toISOString(),
      endTime: new Date(e.getTime() + 15*60000).toISOString()
    });
    expect(res.status).toBe(409);
  });
});
