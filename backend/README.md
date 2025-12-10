Washstore Backend (Node.js / Express)

This backend provides:

- PostgreSQL via Prisma ORM
- JWT Admin authentication and REST admin routes
- Public POS REST API endpoints
- A simple WebSocket endpoint for real-time machine status broadcasts

Quick start

1. Install and build project dependencies (inside the `backend` folder):
   ```powershell
   cd backend
   npm install
   npx prisma generate
   npx prisma migrate dev --name init
   npm run seed
   npm run dev
   ```

2. Environment variables: (use `.env` file inside `backend`):
   ```text
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/washstore
   JWT_SECRET=supersecretadminjwt
   PORT=3000
   WS_PORT=8080
   ```

3. REST endpoints (local server):
   - `POST /auth/login` : { email, password }
   - `GET /pos/machine-status`
   - `POST /pos/sale` : { machineId, amount, items }
   - `GET /admin/machines` (requires JWT token)
   - `POST /admin/machines` (requires JWT token)

4. WebSocket endpoint:
   - Connected on `ws://localhost:3000/ws` (or `ws://<proxy-host>/ws` when using NGINX)

Notes

- Prisma migrations will create the tables; you can seed the admin using `npm run seed`.
- To connect the frontend, set `VITE_API_URL=http://localhost:3000` and `VITE_HW_BRIDGE_URL=ws://localhost:3000/ws` in the front-end `.env`.

Docker

- The `deployment/docker-compose.yml` has a basic example to run Postgres, the backend and nginx as a reverse proxy; modify ports and bind-mounts as needed.
