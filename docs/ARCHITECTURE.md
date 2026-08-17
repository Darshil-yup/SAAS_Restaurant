# Architecture Overview — LAN-First Offline Restaurant POS

## Core Architectural Vision

In high-volume restaurant environments, internet connectivity is intermittent and unreliable. Traditional cloud-dependent POS systems freeze or fail during internet outages, creating immediate operational bottlenecks, delayed KOT delivery to kitchens, and lost revenue.

This system implements a **LAN-First Network Architecture** where:
1. **Reception Laptop** acts as the local single source of truth (`/hub-server`).
2. **Waiter Handsets** interact purely with the local Hub over high-speed local WiFi (`http://<LAN-IP>:4000`).
3. **Kitchen Displays (KDS)** receive real-time ticket pushes over WebSocket (`ws://<LAN-IP>:4000/live`) in < 1 second.
4. **Cloud Synchronization** runs asynchronously in the background when internet connectivity is available, satisfying Supabase Row Level Security (RLS) policies.

---

## Topology & Data Flow Diagram

```
                              +-------------------------------------------------------------+
                              |                      RECEPTION LAPTOP                       |
                              |                                                             |
                              |  +-------------------------------------------------------+  |
                              |  |                Hub Server (Node/Express)              |  |
                              |  |                     Binds: 0.0.0.0                    |  |
                              |  |                                                       |  |
                              |  |  * POST /orders               * GET /orders/active    |  |
                              |  |  * POST /orders/:id/ready     * GET /tables           |  |
                              |  |  * WS /live                   * GET /sync-status      |  |
                              |  +---------------------------+---------------------------+  |
                              |                              |                              |
                              |               Serves static  | Async Cloud Sync             |
                              |               build at /     | (RLS Kitchen Staff Auth)     |
                              |                              v                              |
                              |  +-------------------------------------------------------+  |
                              |  |             Kitchen Hub Display (Browser)             |  |
                              |  |  - Displays pairing code & QR code for LAN IP         |  |
                              |  |  - Restores open tickets from GET /orders/active      |  |
                              |  |  - Listens to real-time tickets via WS /live          |  |
                              |  |  - Displays live cloud sync status indicator          |  |
                              |  +-------------------------------------------------------+  |
                              +------------------------------^------------------------------+
                                                             |
                                                             | HTTP / WS over LAN WiFi
                                                             | (Zero Internet Required)
                                                             |
                                              +--------------+--------------+
                                              |   Waiter Phone (Local WiFi) |
                                              |  +-----------------------+  |
                                              |  |   Standalone PWA      |  |
                                              |  |   (manifest + sw)     |  |
                                              |  |   - QR Scanner Pair   |  |
                                              |  |   - Rapid Order Build |  |
                                              |  |   - Offline State UI  |  |
                                              |  +-----------------------+  |
                                              +-----------------------------+
```

---

## Zero-Trust RLS Security Model

- The Hub Server authenticates with Supabase using **Anonymous Authentication** mapped to a dedicated `role = 'kitchen'` row in `public.staff_users` for the paired restaurant ID.
- This ensures `current_restaurant_id()` in Supabase SQL policies resolves natively under Row Level Security.
- **No `service_role` key** is used on the hub or clients, preventing database-wide bypasses on local devices sitting in physical restaurants.
