# DESIGN.md

## Overview
Meeting Room Booking Service — Node.js + Express + PostgreSQL.

### Main Entities
- **rooms**: id, name, capacity, floor, amenities[], timezone
- **bookings**: id, room_id, title, organizer_email, start_time (timestamptz), end_time (timestamptz), status (confirmed|cancelled), idempotency_key
- **idempotency_keys**: persists Idempotency-Key per organizer to survive restarts

## Data model (summary)
- `rooms` table stores timezone per room so business hours checks use room local time.
- `bookings` stores booking intervals as `tstzrange` (generated column). An exclusion constraint prevents overlapping confirmed bookings for same room (Postgres `EXCLUDE USING GIST`).
- `idempotency_keys` provides uniqueness `(organizer_email, idempotency_key)` and stores booking_id & status.

## Enforcing no overlaps
- DB-level safety: `EXCLUDE USING GIST (room_id WITH =, time_range WITH &&) WHERE (status = 'confirmed')`.
- Advantage: prevents race conditions across application instances.
- Application uses transactions to attempt insert; conflict results in Postgres throwing error (SQLSTATE `23P01`), which we translate to HTTP 409.

## Idempotency implementation
- Clients send `Idempotency-Key` header.
- We persist keys in `idempotency_keys` table with `organizer_email` (to scope keys per organizer). Unique constraint on `(organizer_email, idempotency_key)`.
- On first request: insert record with `status='in_progress'`. After booking created, update record with booking_id and `status='completed'`.
- If same key arrives again:
  - If `completed`: return same booking (no duplicate).
  - If `in_progress`: detect and respond with 409 or wait (we choose to signal conflict to client).
- This persists across process restarts.

## Concurrency
- Use DB transactions + exclusion constraint for overlaps.
- Idempotency uniqueness done at DB level to avoid duplicates under concurrency.
- If stronger guarantees required, we can use `SELECT FOR UPDATE` on idempotency_keys row to block racing requests, or add advisory locks per `(organizer_email, key)`.

## Error handling
- All errors return JSON:
```json
{
  "error": "ErrorCode",
  "message": "human friendly message"
}
