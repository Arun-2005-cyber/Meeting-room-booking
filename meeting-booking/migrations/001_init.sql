-- Enable extensions required for exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, -- we'll enforce case-insensitive uniqueness at app-level
  capacity INT NOT NULL CHECK (capacity >= 1),
  floor INT,
  amenities TEXT[] DEFAULT ARRAY[]::text[],
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  organizer_email TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);

-- Index to quickly lookup bookings per room and time
CREATE INDEX IF NOT EXISTS idx_bookings_room_time ON bookings (room_id, start_time, end_time);

-- To persist idempotency and prevent duplicates per organizer:
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id SERIAL PRIMARY KEY,
  organizer_email TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  booking_id INT, -- set after booking created
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  UNIQUE (organizer_email, idempotency_key)
);

-- Exclusion constraint to avoid overlapping confirmed bookings for same room
-- It prevents two rows with status='confirmed' having overlapping time ranges for same room_id.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS time_range tstzrange GENERATED ALWAYS AS (tstzrange(start_time, end_time, '[]')) STORED;

-- Add exclusion constraint using gist to prevent overlapping ranges for same room_id when status='confirmed'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_overlap_confirmed_bookings'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT no_overlap_confirmed_bookings
      EXCLUDE USING GIST (
        room_id WITH =,         -- default operator "=" (no need to specify class)
        time_range WITH &&
      )
      WHERE (status = 'confirmed');
  END IF;
END$$;

