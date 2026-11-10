Washstore Backend (Node.js / Express)

This backend provides:

- MongoDB via Mongoose
- JWT Admin authentication and REST admin routes
- Public POS REST API endpoints
- A simple WebSocket endpoint for real-time machine status broadcasts

Quick start

1. Install and build project dependencies (inside the `backend` folder):
   ```powershell
   cd backend
   npm install
   # Ensure your MongoDB is running and accessible at MONGODB_URL
   npm run seed
   npm run dev
   ```

2. Environment variables: (use `.env` file inside `backend`):
   ```text
   MONGODB_URL=mongodb://localhost:27017/washstore
   JWT_SECRET=supersecretadminjwt
   PORT=3000
   WS_PORT=8080
   ```

3. Seed & DB notes

 - `npm run seed` now waits up to ~15s for a local MongoDB server (configured by `MONGODB_URL`) to be reachable and will print a clear message if it cannot connect. If you prefer to skip this waiting behavior, set `SEED_WAIT=false` and run the command; note the seed will then fail if the DB is not reachable.
 - `npm run seed` will create the admin and kiosk users if missing. The defaults are:
    - Admin: username `admin`, password from `ADMIN_PASSWORD` (a random one is generated and printed when it is not set).
    - Kiosk: username `kiosk`, password from `KIOSK_PASSWORD` (same rule).

4. REST endpoints (local server):
   - `POST /auth/login` : { username, password }
   - `GET /pos/machine-status`
   - `POST /pos/sale` : { machineId, amount, items }
   Authentication
   --------------
   Kiosk devices can authenticate using either a JWT or an API key. The seed script creates a kiosk user with an `apiKey` that can be used directly in the request or exchanged for a JWT.

   - Use API key (recommended for kiosk devices):
      - Header: `x-api-key: <KIOSK_API_KEY>` or `Authorization: ApiKey <KIOSK_API_KEY>`
      - This is accepted by the backend and allows calls to kiosk-protected endpoints such as `POST /pos/sale`.
   - Use JWT: exchange credentials via `POST /api/auth/login` (send `{ apiKey: '<key>' }`) to receive a token and then use `Authorization: Bearer <token>` in subsequent requests.

   Admin users continue to use username/password login and will receive a JWT that grants access to admin endpoints.
   - `GET /admin/machines` (requires JWT token)
   - `POST /admin/machines` (requires JWT token)

4. WebSocket endpoint:
   - Connected on `ws://localhost:3000/ws` (or `ws://<proxy-host>/ws` when using NGINX)

Notes

 - To seed the admin user + sample machines, run `npm run seed`.
- To connect the frontend, set `VITE_API_URL=http://localhost:3000` and `VITE_HW_BRIDGE_URL=ws://localhost:3000/ws` in the front-end `.env`.

Deployment

 - No Docker/deployment config is checked into this repo yet. For a production host (e.g. Hetzner), run MongoDB, this backend (`npm start`, with a real `JWT_SECRET`/`MONGODB_URL`/`PORT` in the environment), and a reverse proxy (nginx or similar) terminating TLS in front of it.
