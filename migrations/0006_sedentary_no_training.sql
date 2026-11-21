-- "Desk job, no workouts" users have no training days.
UPDATE users SET training_days = '[]' WHERE activity = 'sedentary';
