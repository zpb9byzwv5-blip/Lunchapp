ALTER TABLE users
ADD COLUMN IF NOT EXISTS email VARCHAR(150),
ADD COLUMN IF NOT EXISTS pin_code VARCHAR(64) NOT NULL DEFAULT '1234';

UPDATE users SET email = 'alex.smith@school.sch.uk', pin_code = '1234' WHERE nfc_uid = '04A25F8B12';
UPDATE users SET email = 'sam.jones@school.sch.uk',  pin_code = '5678' WHERE nfc_uid = '04B91C3D44';

ALTER TABLE users ALTER COLUMN email SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
