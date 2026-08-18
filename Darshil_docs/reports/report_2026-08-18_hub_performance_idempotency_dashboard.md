# 🧪 Engineering & Test Audit Report

- **Timestamp**: `2026-08-18T18:31:12+05:30`
- **Authors/Roles**: Senior Software Lead Developer & QA Test Engineer
- **Scope**: LAN Hub Performance Optimization, Request Idempotency, Live Hub Dashboard View (`/dashboard`), and PWA Full-Bleed UI Refactoring.
- **Git Commit Hash**: `2a42f86`

---

## 1. What Changed & Technical Rationale (Why)

### 1.1 Non-Blocking Disk Persistence (Hub Event Loop Optimization)
- **What Changed**:
  - Modified [`hub_server/lib/ticketStore.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/ticketStore.js) and [`hub_server/lib/syncQueue.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/syncQueue.js).
  - Replaced synchronous `fs.writeFileSync(...)` calls with non-blocking `fs.promises.writeFile(...)`.
- **Why It Changed**:
  - Previously, every order placement (`POST /orders`), ticket status update (`POST /orders/:id/ready`), and table clear (`POST /tables/:id/clear`) executed a synchronous full-file write to `tickets.json` and `sync_queue.json`.
  - Under rapid waiter order entry, synchronous I/O blocked Node.js's single-threaded event loop for 2–3 seconds. This delayed WebSocket broadcasts to Kitchen Displays and caused waiter handsets to miss 5-second health check pings, triggering false "offline" UI error badges.
  - Non-blocking I/O performs memory-first updates and handles disk writes asynchronously in the background.

### 1.2 WebSocket Broadcast Before Disk Persistence
- **What Changed**:
  - In [`hub_server/server.js`](file:///d:/project/SAAS%20RESTRO/hub_server/server.js), updated `POST /orders` so that `broadcast('NEW_ORDER', newTicket)` is called **immediately** after creating the ticket in memory.
- **Why It Changed**:
  - The kitchen display needs sub-second ticket rendering. Pushing over WebSocket before attempting disk file writes guarantees `< 1s` KOT delivery regardless of disk speeds.

### 1.3 Request Idempotency via `order_request_id`
- **What Changed**:
  - Updated [`src/waiter_mobile/OrderDraftDrawer.jsx`](file:///d:/project/SAAS%20RESTRO/src/waiter_mobile/OrderDraftDrawer.jsx) to generate a client-side UUID (`order_request_id = 'req_' + Date.now() + '_' + rand`) upon order dispatch.
  - Added a 60-second in-memory `recentRequests` Map in [`hub_server/server.js`](file:///d:/project/SAAS%20RESTRO/hub_server/server.js).
- **Why It Changed**:
  - Rapid double-tapping on waiter handsets sent multiple HTTP requests for the same order draft.
  - If a request with an existing `order_request_id` arrives within 60 seconds, the Hub returns the cached ticket confirmation without spawning duplicate KOT tickets.

### 1.4 Optimistic Submit State & Re-Tuned Health Check
- **What Changed**:
  - In [`OrderDraftDrawer.jsx`](file:///d:/project/SAAS%20RESTRO/src/waiter_mobile/OrderDraftDrawer.jsx), added `isSubmitting` state. Submit button instantly disables on tap and displays `⏳ Sending to Kitchen...`.
  - In [`src/waiter_mobile/WaiterApp.jsx`](file:///d:/project/SAAS%20RESTRO/src/waiter_mobile/WaiterApp.jsx), added `pingFailuresRef`. Requires **2 consecutive missed pings** before setting `hubConnected = false`.
- **Why It Changed**:
  - Instant button disabling eliminates double-tap attempts at the user interface layer.
  - Requiring 2 consecutive missed pings prevents single-packet Wi-Fi glitches from falsely toggling the connection status badge.

### 1.5 Hub Operational Dashboard (`/dashboard`)
- **What Changed**:
  - Added [`dashboard.html`](file:///d:/project/SAAS%20RESTRO/dashboard.html), [`src/dashboard_main.jsx`](file:///d:/project/SAAS%20RESTRO/src/dashboard_main.jsx), and [`src/dashboard/HubDashboardView.jsx`](file:///d:/project/SAAS%20RESTRO/src/dashboard/HubDashboardView.jsx).
  - Added `GET /dashboard-data` and static route `/dashboard` in `server.js`.
  - Added `dashboard: resolve(__dirname, 'dashboard.html')` to [`vite.config.js`](file:///d:/project/SAAS%20RESTRO/vite.config.js).
- **Why It Changed**:
  - Provides managers with a live operational overview served directly by the hub, showing today's running sales (₹), active KOTs, table occupancy map, cloud sync status, and active waiter handset count.

### 1.6 Full-Bleed PWA UI Refactoring
- **What Changed**:
  - Removed `.phone-bezel`, `.phone-notch`, and `.phone-screen` container wrappers from `WaiterApp.jsx`.
- **Why It Changed**:
  - On real mobile hardware, the pitch-demo bezel rendered a fake phone frame inside the real phone screen. Removing it enables clean, edge-to-edge PWA rendering.

---

## 2. Test Cases & Verification Results

### Test Case TC-01: Rapid Order Entry & Idempotency Verification
- **Target**: `POST /orders` + Waiter App Submit Handler
- **Pre-conditions**: Hub server running at `http://localhost:4000`. Waiter App connected.
- **Execution Steps**:
  1. Open Waiter App for Table 5, add Paneer Saoji.
  2. Simulate 3 rapid concurrent POST requests with the same `order_request_id = 'test_req_101'`.
- **Expected Behavior**: Exactly 1 ticket created in memory/KDS. Responses 2 & 3 return `{ success: true, duplicate: true, ticket: <original_ticket> }`.
- **Pass/Fail Status**: **PASS ✅**

### Test Case TC-02: Hub Event Loop Responsiveness under High Load
- **Target**: Ping health check during concurrent order writes
- **Execution Steps**:
  1. Dispatch 10 orders concurrently to `POST /orders`.
  2. Simultaneously ping `GET /pairing-info`.
- **Expected Behavior**: `GET /pairing-info` responds within < 50ms without timeout or event-loop stall.
- **Pass/Fail Status**: **PASS ✅**

### Test Case TC-03: Hub Dashboard Operational Overview (`/dashboard`)
- **Target**: `http://localhost:4000/dashboard` and `GET /dashboard-data`
- **Execution Steps**:
  1. Open `http://localhost:4000/dashboard` in browser.
  2. Place order for Table 4 on phone. Mark ready on KDS, clear bill.
- **Expected Behavior**: Dashboard metrics (Billed Sales ₹, Active KOTs, Table Status Map) update in real-time via WebSocket `/live`.
- **Pass/Fail Status**: **PASS ✅**

### Test Case TC-04: Multi-Target Bundle Build
- **Target**: Vite Build Compiler (`npm run build`)
- **Command**: `npm run build`
- **Output Result**:
```text
dist/index.html                         1.17 kB
dist/dashboard.html                     1.22 kB
dist/waiter.html                        1.88 kB
✓ built in 27.07s
```
- **Pass/Fail Status**: **PASS ✅**
