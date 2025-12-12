// src/services/bookingService.js
const db = require('../db');
const { DateTime } = require('luxon');

const BUSINESS_START = { hour: 8, minute: 0 };
const BUSINESS_END = { hour: 20, minute: 0 };
const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 4 * 60;

function parseFlexibleDateTime(input, timezone) {
    if (!input || typeof input !== 'string') return DateTime.invalid('invalid input');

    const tz = timezone || 'UTC';
    const trimmed = input.trim();

    // If looks like ISO or contains a date separator, try ISO parse first
    if (/[T\-\/]/.test(trimmed)) {
        // Accept "YYYY-MM-DD HH:mm" as ISO-ish by replacing space with T
        let isoCandidate = trimmed;
        if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)) {
            isoCandidate = trimmed.replace(' ', 'T');
        }
        const dtIso = DateTime.fromISO(isoCandidate, { zone: tz });
        if (dtIso.isValid) return dtIso;
    }

    // Try common formats that include date+time (space separated)
    const dateTimeFormats = [
        'yyyy-MM-dd HH:mm',
        'yyyy-MM-dd H:mm',
        'yyyy/MM/dd HH:mm',
        'dd-MM-yyyy HH:mm',
    ];
    for (const f of dateTimeFormats) {
        const dt = DateTime.fromFormat(trimmed, f, { zone: tz });
        if (dt.isValid) return dt;
    }

    // If there is an AM/PM indicator or a colon with hour < 13, try 12-hour formats
    const formats12 = ['h a', 'h:mm a', 'hh a', 'hh:mm a', 'h:mma', 'hh:mma'];
    for (const f of formats12) {
        const dt = DateTime.fromFormat(trimmed.toUpperCase(), f, { zone: tz });
        if (dt.isValid) {
            // No date provided -> attach today's date in that timezone
            const today = DateTime.now().setZone(tz).startOf('day');
            return today.set({ hour: dt.hour, minute: dt.minute, second: 0, millisecond: 0 });
        }
    }

    // Try 24-hour time like "17:00" or "7:30"
    const formats24 = ['H:mm', 'HH:mm', 'H'];
    for (const f of formats24) {
        const dt = DateTime.fromFormat(trimmed, f, { zone: tz });
        if (dt.isValid) {
            const today = DateTime.now().setZone(tz).startOf('day');
            return today.set({ hour: dt.hour, minute: dt.minute, second: 0, millisecond: 0 });
        }
    }

    // Lastly, try generic ISO fallback
    const dtFallback = DateTime.fromISO(trimmed, { zone: tz });
    return dtFallback;
}

function isWithinBusinessHoursDT(startDT, endDT) {
    // Both startDT and endDT are Luxon DateTime already set to room timezone
    if (!startDT.isValid || !endDT.isValid) return false;
    // Check weekday Mon-Fri
    if (startDT.weekday > 5 || endDT.weekday > 5) return false;
    // Business day boundaries (same date as start)
    const businessStart = startDT.set(BUSINESS_START);
    const businessEnd = startDT.set(BUSINESS_END);
    return (startDT >= businessStart && endDT <= businessEnd);
}

async function createBooking(payload, idempotency) {
    // Accept either snake_case or camelCase fields
    const roomId = payload.roomId || payload.room_id;
    const organizerEmail = payload.organizerEmail || payload.organizer_email;
    const startRaw = payload.startTime || payload.start_time;
    const endRaw = payload.endTime || payload.end_time;
    const title = payload.title;
    const status = payload.status || 'confirmed';

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1) Check room exists
        const roomRes = await client.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
        if (!roomRes.rows.length) {
            const err = new Error('Unknown room');
            err.status = 404;
            throw err;
        }
        const room = roomRes.rows[0];

        // 2) Parse start/end into DateTime using room timezone
        const startDT = parseFlexibleDateTime(String(startRaw), room.timezone || 'UTC');
        const endDT = parseFlexibleDateTime(String(endRaw), room.timezone || 'UTC');

        if (!startDT.isValid || !endDT.isValid) {
            const err = new Error('Invalid time format. Use formats like "2025-12-13T10:00", "2025-12-13 10:00", "6 AM", "5:30PM", or "17:00"');
            err.status = 400;
            throw err;
        }

        if (startDT >= endDT) {
            const err = new Error('startTime must be before endTime');
            err.status = 400;
            throw err;
        }

        // 3) Duration checks
        const durationMin = Math.round(endDT.diff(startDT, 'minutes').minutes);
        if (durationMin < MIN_DURATION_MIN || durationMin > MAX_DURATION_MIN) {
            const err = new Error(`Booking duration must be between ${MIN_DURATION_MIN} and ${MAX_DURATION_MIN} minutes`);
            err.status = 400;
            throw err;
        }

        // 4) Business hours check (room's timezone)
        if (!isWithinBusinessHoursDT(startDT.setZone(room.timezone), endDT.setZone(room.timezone))) {
            const err = new Error('Bookings allowed Mon–Fri, 08:00–20:00 in room local time');
            err.status = 400;
            throw err;
        }

        // 5) Idempotency handling
        let existingBooking = null;
        if (idempotency && idempotency.key) {
            try {
                const ins = await client.query(
                    `INSERT INTO idempotency_keys (organizer_email, idempotency_key, status) 
           VALUES ($1, $2, 'in_progress') RETURNING *`,
                    [organizerEmail, idempotency.key]
                );
                idempotency.recordId = ins.rows[0].id;
            } catch (e) {
                // Unique violation: another request used same organizer+key
                const get = await client.query(
                    `SELECT b.* FROM idempotency_keys ik JOIN bookings b ON ik.booking_id = b.id WHERE ik.organizer_email=$1 AND ik.idempotency_key=$2`,
                    [organizerEmail, idempotency.key]
                );
                if (get.rows.length) {
                    existingBooking = get.rows[0];
                    await client.query('COMMIT');
                    return mapBookingRow(existingBooking);
                } else {
                    // check status of idempotency key
                    const ik = await client.query('SELECT * FROM idempotency_keys WHERE organizer_email=$1 AND idempotency_key=$2', [organizerEmail, idempotency.key]);
                    const row = ik.rows[0];
                    if (row && row.status === 'in_progress') {
                        const err = new Error('Idempotent request already in progress');
                        err.status = 409;
                        throw err;
                    } else if (row && row.status === 'completed') {
                        const b = await client.query('SELECT * FROM bookings WHERE idempotency_key=$1 AND organizer_email=$2', [idempotency.key, organizerEmail]);
                        if (b.rows.length) {
                            await client.query('COMMIT');
                            return mapBookingRow(b.rows[0]);
                        }
                    }
                    // otherwise continue to attempt booking
                }
            }
        }

        // 6) Insert booking - convert DateTime to ISO strings (UTC) for DB
        const insertQuery = `
      INSERT INTO bookings (room_id, title, organizer_email, start_time, end_time, status, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `;
        try {
            const res = await client.query(insertQuery, [
                roomId,
                title,
                organizerEmail,
                startDT.toUTC().toISO(), // store as timestamptz
                endDT.toUTC().toISO(),
                status,
                idempotency && idempotency.key ? idempotency.key : null
            ]);
            const booking = res.rows[0];

            // 7) Mark idempotency completed
            if (idempotency && idempotency.recordId) {
                await client.query(
                    `UPDATE idempotency_keys SET booking_id = $1, status = 'completed' WHERE id = $2`,
                    [booking.id, idempotency.recordId]
                );
            } else if (idempotency && idempotency.key) {
                await client.query(
                    `INSERT INTO idempotency_keys (organizer_email, idempotency_key, booking_id, status)
           VALUES ($1, $2, $3, 'completed')
           ON CONFLICT (organizer_email, idempotency_key) DO UPDATE SET booking_id = EXCLUDED.booking_id, status='completed'`,
                    [organizerEmail, idempotency.key, booking.id]
                );
            }

            await client.query('COMMIT');
            return mapBookingRow(booking);
        } catch (err) {
            await client.query('ROLLBACK');
            // Exclusion constraint or overlap error (SQLSTATE 23P01)
            if (err.code === '23P01' || (err.constraint && err.constraint === 'no_overlap_confirmed_bookings')) {
                const e = new Error('Booking overlaps with existing confirmed booking');
                e.status = 409;
                throw e;
            }
            throw err;
        }
    } finally {
        client.release();
    }
}

function mapBookingRow(row) {
    return {
        id: row.id,
        roomId: row.room_id,
        title: row.title,
        organizerEmail: row.organizer_email,
        startTime: row.start_time ? DateTime.fromJSDate(new Date(row.start_time)).toISO() : null,
        endTime: row.end_time ? DateTime.fromJSDate(new Date(row.end_time)).toISO() : null,
        status: row.status,
        idempotencyKey: row.idempotency_key
    };
}

async function listBookings({ roomId, from, to, limit = 20, offset = 0 }) {
    const params = [];
    const clauses = [];
    if (roomId) {
        params.push(roomId);
        clauses.push(`room_id = $${params.length}`);
    }
    if (from) {
        params.push(from);
        clauses.push(`end_time >= $${params.length}`);
    }
    if (to) {
        params.push(to);
        clauses.push(`start_time <= $${params.length}`);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const itemsRes = await db.query(
        `SELECT * FROM bookings ${where} ORDER BY start_time LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
    );
    const countRes = await db.query(`SELECT COUNT(*) FROM bookings ${where}`, params);
    return {
        items: itemsRes.rows.map(mapBookingRow),
        total: Number(countRes.rows[0].count),
        limit,
        offset
    };
}

async function cancelBooking(id) {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const res = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        if (!res.rows.length) {
            const err = new Error('Booking not found');
            err.status = 404;
            throw err;
        }

        const booking = res.rows[0];

        // Already cancelled?
        if (booking.status === 'cancelled') {
            await client.query('COMMIT');
            return mapBookingRow(booking);
        }
        const upd = await client.query(
            'UPDATE bookings SET status = $1, cancelled_at = now() WHERE id = $2 RETURNING *',
            ['cancelled', id]
        );

        await client.query('COMMIT');
        return mapBookingRow(upd.rows[0]);

    } finally {
        client.release();
    }
}


async function roomUtilization({ from, to }) {
    if (!from || !to) {
        const err = new Error('from and to query parameters are required');
        err.status = 400;
        throw err;
    }
    const fromDT = DateTime.fromISO(from, { zone: 'UTC' });
    const toDT = DateTime.fromISO(to, { zone: 'UTC' });
    if (!fromDT.isValid || !toDT.isValid || fromDT >= toDT) {
        const err = new Error('Invalid from/to range');
        err.status = 400;
        throw err;
    }

    // Fetch all rooms
    const roomsRes = await db.query('SELECT * FROM rooms ORDER BY id');
    const rooms = roomsRes.rows;

    // For each room, compute booked hours in [from,to] (only confirmed bookings)
    const report = [];
    for (const room of rooms) {
        const bRes = await db.query(
            `SELECT start_time, end_time FROM bookings WHERE room_id = $1 AND status='confirmed' AND NOT (end_time <= $2 OR start_time >= $3)`,
            [room.id, from, to]
        );
        let totalBookedMinutes = 0;
        for (const row of bRes.rows) {
            const s = DateTime.fromJSDate(new Date(row.start_time)).toUTC();
            const e = DateTime.fromJSDate(new Date(row.end_time)).toUTC();
            const overlapStart = s < fromDT ? fromDT : s;
            const overlapEnd = e > toDT ? toDT : e;
            const minutes = Math.max(0, overlapEnd.diff(overlapStart, 'minutes').minutes);
            totalBookedMinutes += minutes;
        }

        // compute business hours between from and to in the room timezone
        const businessMinutes = computeBusinessMinutesBetween(fromDT, toDT, room.timezone);
        const utilization = businessMinutes === 0 ? 0 : (totalBookedMinutes / businessMinutes);

        report.push({
            roomId: room.id,
            roomName: room.name,
            totalBookingHours: Number((totalBookedMinutes / 60).toFixed(2)),
            utilizationPercent: Number(utilization.toFixed(4))
        });
    }

    return report;
}

function computeBusinessMinutesBetween(fromDT, toDT, timezone) {
    let total = 0;
    let cursor = fromDT.startOf('day');
    while (cursor < toDT) {
        const nextDay = cursor.plus({ days: 1 });
        const dayStart = cursor.setZone(timezone);
        const weekday = dayStart.weekday;
        if (weekday <= 5) {
            const businessStart = cursor.setZone(timezone).set(BUSINESS_START).toUTC();
            const businessEnd = cursor.setZone(timezone).set(BUSINESS_END).toUTC();
            const dayIntervalStart = businessStart < fromDT ? fromDT : businessStart;
            const dayIntervalEnd = businessEnd > toDT ? toDT : businessEnd;
            if (dayIntervalEnd > dayIntervalStart) {
                total += dayIntervalEnd.diff(dayIntervalStart, 'minutes').minutes;
            }
        }
        cursor = nextDay;
    }
    return total;
}

module.exports = {
    createBooking,
    listBookings,
    cancelBooking,
    roomUtilization
};
