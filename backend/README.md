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

4. REST endpoints (local server):
   - `POST /auth/login` : { email, password }
   - `GET /pos/machine-status`
   - `POST /pos/sale` : { machineId, amount, items }
   - `GET /admin/machines` (requires JWT token)
   - `POST /admin/machines` (requires JWT token)

4. WebSocket endpoint:
   - Connected on `ws://localhost:3000/ws` (or `ws://<proxy-host>/ws` when using NGINX)

Notes

 - To seed the admin user + sample machines, run `npm run seed`.
- To connect the frontend, set `VITE_API_URL=http://localhost:3000` and `VITE_HW_BRIDGE_URL=ws://localhost:3000/ws` in the front-end `.env`.

Docker

 - The `deployment/docker-compose.yml` has a basic example to run MongoDB, the backend and nginx as a reverse proxy; modify ports and bind-mounts as needed.
