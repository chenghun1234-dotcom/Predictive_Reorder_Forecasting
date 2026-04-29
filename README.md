# Predictive Reorder Forecasting (PRF) API

A high-performance, zero-cost API for predicting product exhaustion and reorder timing using statistical algorithms (EMA) on Cloudflare's infrastructure.

## Getting Started

### 1. Prerequisites
- Node.js & npm
- Cloudflare Account (for deployment)

### 2. Setup
```bash
npm install
```

### 3. Initialize Database (Local)
```bash
npx wrangler d1 execute prf-db --local --file=schema.sql
```

### 4. Run Locally
```bash
npm run dev
```
Open [http://localhost:8787](http://localhost:8787) to see the interactive landing page.

### 5. Deployment
1. Create a D1 database in your Cloudflare dashboard:
   ```bash
   npx wrangler d1 create prf-db
   ```
2. Update `wrangler.jsonc` with the `database_id` provided.
3. Initialize the production database:
   ```bash
   npx wrangler d1 execute prf-db --remote --file=schema.sql
   ```
4. Deploy the worker:
   ```bash
   npm run deploy
   ```

## API Endpoints

### `POST /v1/log-order`
Logs a purchase and updates the prediction model.
- `user_id`: Unique identifier for the user.
- `item_id`: Unique identifier for the product (e.g., "milk").
- `quantity`: Amount purchased.
- `household_size`: (Optional) Used for cold-start prediction.

### `GET /v1/predict`
Retrieves the next predicted purchase date.
- Query Params: `user_id`, `item_id`.

---
Built with ❤️ using Cloudflare Workers & D1.
