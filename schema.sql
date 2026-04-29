-- Schema for Predictive Reorder Forecasting (PRF) API

-- Store user orders
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    order_date INTEGER NOT NULL, -- Unix timestamp
    quantity REAL NOT NULL,
    household_size INTEGER DEFAULT 1,
    unit TEXT
);

-- Store calculated patterns and prediction state
CREATE TABLE IF NOT EXISTS patterns (
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    average_cycle REAL NOT NULL, -- Average days per unit
    last_purchase_date INTEGER NOT NULL,
    last_quantity REAL NOT NULL,
    data_points INTEGER DEFAULT 1,
    confidence_score REAL DEFAULT 0.5,
    PRIMARY KEY (user_id, item_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_user_item ON orders(user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_patterns_user_item ON patterns(user_id, item_id);
