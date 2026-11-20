-- Custom walk reminder time (minute of day); NULL = 30 min after work / 3 h after waking.
ALTER TABLE users ADD COLUMN walk_time INTEGER;
-- A snoozed walk reminder: re-send on this local date once this minute of day is reached.
ALTER TABLE users ADD COLUMN walk_snooze_date TEXT;
ALTER TABLE users ADD COLUMN walk_snooze_minute INTEGER;
-- JSON ISO weekdays 1..7 with training; protein shakes are fine on these days.
ALTER TABLE users ADD COLUMN training_days TEXT NOT NULL DEFAULT '[]';
