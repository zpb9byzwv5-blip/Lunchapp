CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nfc_uid VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    year_group VARCHAR(20) NOT NULL DEFAULT 'Year 11',
    is_fsm BOOLEAN NOT NULL DEFAULT false,
    wallet_pence INTEGER NOT NULL DEFAULT 0 CHECK (wallet_pence >= 0)
);

CREATE TABLE IF NOT EXISTS menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_date DATE NOT NULL DEFAULT CURRENT_DATE,
    course_type VARCHAR(10) NOT NULL CHECK (course_type IN ('MAIN', 'DRINK')),
    dish_name VARCHAR(100) NOT NULL,
    price_pence INTEGER NOT NULL CHECK (price_pence IN (265, 100)),
    stock_remaining INTEGER NOT NULL DEFAULT 150 CHECK (stock_remaining >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS pre_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    service_date DATE NOT NULL DEFAULT CURRENT_DATE,
    main_item_id UUID NULL REFERENCES menu_items(id),
    drink_item_id UUID NULL REFERENCES menu_items(id),
    summary_text VARCHAR(255) NOT NULL,
    subtotal_pence INTEGER NOT NULL DEFAULT 0,
    fsm_covered_pence INTEGER NOT NULL DEFAULT 0,
    wallet_charged_pence INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(15) NOT NULL DEFAULT 'PLACED' CHECK (status IN ('PLACED', 'COLLECTED')),
    collected_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, service_date)
);

CREATE INDEX IF NOT EXISTS idx_users_nfc_uid ON users(nfc_uid);
CREATE INDEX IF NOT EXISTS idx_pre_orders_date_user ON pre_orders(service_date, user_id);

INSERT INTO users (id, nfc_uid, full_name, year_group, is_fsm, wallet_pence) VALUES
('11111111-1111-1111-1111-111111111111', '04A25F8B12', 'Alex Smith (FSM)', 'Year 11', true, 250),
('22222222-2222-2222-2222-222222222222', '04B91C3D44', 'Sam Jones (Standard)', 'Year 10', false, 600)
ON CONFLICT (nfc_uid) DO NOTHING;

INSERT INTO menu_items (service_date, course_type, dish_name, price_pence, stock_remaining) VALUES
(CURRENT_DATE, 'MAIN', 'Chicken Katsu Curry & Rice', 265, 80),
(CURRENT_DATE, 'MAIN', 'Beef Lasagne & Garlic Bread', 265, 60),
(CURRENT_DATE, 'MAIN', 'Roasted Vegetable Pesto Pasta (V)', 265, 50),
(CURRENT_DATE, 'DRINK', 'Chilled Still Water (500ml)', 100, 200),
(CURRENT_DATE, 'DRINK', 'Apple Sparkler', 100, 120),
(CURRENT_DATE, 'DRINK', 'Orange Juice Carton', 100, 120);
