-- Keep what's needed to re-estimate a meal from a user correction.
ALTER TABLE meals ADD COLUMN photo_file_id TEXT;
ALTER TABLE meals ADD COLUMN caption TEXT;
-- Meal awaiting a correction text, and the result message to retire once it's re-estimated.
ALTER TABLE users ADD COLUMN editing_meal_id INTEGER;
ALTER TABLE users ADD COLUMN editing_message_id INTEGER;
