-- M1: Real-Data Calibration
-- daily_metrics gains body fat % (Hevy measurement_data.csv);
-- exercises gain machine_type for effective-load analytics.

ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS body_fat_pct DECIMAL;

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS machine_type TEXT;