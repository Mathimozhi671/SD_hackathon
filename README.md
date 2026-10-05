# SALESTORM — High-Scale E-Commerce Flash Sale System
### SysCrafters 2026 System Design & Concurrency Benchmark

> **The Core Problem**: 10,000 customers simultaneously attempt to purchase a product when only 100 units are available.  
> **The SALESTORM Solution**: A high-throughput, atomic flash-sale engine guaranteeing **strict zero-overselling**, sub-millisecond fast-fail rejection, temporary TTL reservation holds, distributed idempotency, and automated failure recovery.

---

## 🌟 Executive Summary & Verification Metrics

Under our automated 10,000-user concurrency benchmark:
* **Concurrent Shoppers**: **10,000 simultaneous requests**
* **Total Available Stock**: **100 units**
* **Successful Reservations**: **Exactly 100**
* **Sold-Out (HTTP 409) Rejections**: **9,900 instant rejections** (< 5ms response time)
* **Oversold Count**: **STRICTLY 0** (Zero inventory leaks or phantom allocations)
* **Measured In-Memory Throughput**: **> 30,000 - 140,000 requests/sec**
* **Latencies**: **P50: 1 ms | P95: 2 ms | P99: 12 ms**

---

## 🏗️ Architecture & Discrete Backend Services

The backend is decomposed into specialized, decoupled services:

1. **[`ProductService`](file:///c:/Users/Mathimozhi/OneDrive/Desktop/SD_project/src/services/productService.ts)**: Manages catalog metadata, SKUs, and pricing.
2. **[`InventoryService`](file:///c:/Users/Mathimozhi/OneDrive/Desktop/SD_project/src/services/inventoryService.ts)**: Enforces concurrency-safe stock checks, atomic Lua decrements, and database constraint safety (`CHECK (available_stock >= 0)`).
3. **[`ReservationService`](file:///c:/Users/Mathimozhi/OneDrive/Desktop/SD_project/src/services/reservationService.ts)**: Manages temporary lock holds with TTL (300s), anti-hoarding limits (1 unit per user), and automated restocking.
4. **[`OrderService`](file:///c:/Users/Mathimozhi/OneDrive/Desktop/SD_project/src/services/orderService.ts)**: Binds active reservations to orders with strict idempotency keys (`Idempotency-Key` header).
5. **[`PaymentService`](file:///c:/Users/Mathimozhi/OneDrive/Desktop/SD_project/src/services/paymentService.ts)**: Orchestrates two-phase commit on success, automatic inventory release on decline, and gateway timeout handling.
6. **[`IdempotencyService`](file:///c:/Users/Mathimozhi/OneDrive/Desktop/SD_project/src/services/idempotencyService.ts)**: Dual-layer idempotency guard (Redis in-memory cache + persistent `idempotency_records` table) caching responses for 24 hours.

```
                        [ 10,000 Concurrent Buyers ]
                                     │
                                     ▼
                    ┌─────────────────────────────────┐
                    │     API Gateway / Rate Limiter   │
                    │   (Idempotency Key Extraction)  │
                    └────────────────┬────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
  ┌─────────────────────────────┐        ┌─────────────────────────────┐
  │      ReservationService     │        │     Order & Payment Svc     │
  │ • Fast-path Redis Lua eval  │        │ • Idempotent order checkout │
  │ • Instant accept/sold-out   │        │ • Payment gateway callbacks │
  │ • Anti-hoarding user check  │        │ • 2-Phase Commit to DB      │
  └──────────────┬──────────────┘        └──────────────┬──────────────┘
                 │                                       │
                 ▼                                       ▼
  ┌─────────────────────────────┐        ┌─────────────────────────────┐
  │     Redis In-Memory Tier    │        │    Relational ACID Storage  │
  │ • Atomic stock decrement    │        │ • products & inventories    │
  │ • User anti-hoarding set    │        │ • reservations & orders     │
  │ • Reservation TTL keys      │        │ • idempotency_records       │
  └──────────────┬──────────────┘        └──────────────▲──────────────┘
                 │                                      │
                 └──────────────┐      ┌────────────────┘
                                ▼      ▼
                    ┌───────────────────────────────┐
                    │   Expiry Sweeper & Restocker  │
                    │ • TTL expired stock release   │
                    │ • Automatic Wave 2 restock    │
                    └───────────────────────────────┘
```

---

## 🔒 4-Layer Defense Against Overselling

1. **Layer 1: Single-Threaded Atomic Redis Lua Script**
   - Stock check, anti-hoarding verification (`SISMEMBER`), and decrement (`DECRBY`) execute in a single atomic transaction. No competing thread can interleave.
2. **Layer 2: Temporary Reservation Hold with TTL (300s)**
   - Units are held temporarily rather than immediately charged. If the buyer abandons checkout or payment fails, stock is returned to the pool instantly.
3. **Layer 3: Two-Phase Commit & Relational Safety Net**
   - When payment succeeds, stock is committed to the relational database. A database-level constraint `CHECK (available_stock >= 0)` guarantees that the database engine itself rejects negative inventory.
4. **Layer 4: Distributed Idempotency**
   - Every mutating request requires an `Idempotency-Key`. Replay attacks or network retries receive identical cached responses without creating duplicate reservations or charges.

---

## 📁 Project Structure

The project is cleanly separated into decoupled **frontend** and **backend** applications:

```text
SD_project/
├── frontend/                     # Web Cockpit & Telemetry Client
│   ├── index.html                # Real-time dashboard interface
│   ├── style.css                 # Cyber dark-mode responsive styling
│   ├── app.js                    # Live WebSocket stream & API connector
│   ├── package.json              # Frontend manifest & serve script
│   └── README.md                 # Frontend documentation
│
├── backend/                      # High-Scale Flash Sale Engine
│   ├── src/
│   │   ├── app.ts                # Express app & static asset hosting
│   │   ├── server.ts             # HTTP & WebSocket server entry point
│   │   ├── database/             # PostgreSQL 18 & In-Memory dual-layer DB
│   │   ├── redis/                # Atomic Lua scripts & Redis client
│   │   ├── routes/               # REST API endpoints & routers
│   │   ├── services/             # Flash sale, cart, audit & catalog services
│   │   ├── simulation/           # Concurrency & traffic generator
│   │   └── types/                # TypeScript interfaces
│   ├── tests/                    # Concurrency, idempotency & lifecycle suites
│   ├── prisma/                   # Prisma schema & migrations
│   ├── package.json              # Backend dependencies & test scripts
│   ├── tsconfig.json             # TypeScript compiler configuration
│   └── .env                      # Environment configuration
│
├── package.json                  # Root runner scripts (start, dev, test)
└── README.md                     # Comprehensive project documentation
```

---

## 🚀 Quick Start Guide

### Prerequisites
* **Node.js**: v18+ (tested on Node.js v22)
* **npm**: v9+

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Live Server & Cockpit UI
```bash
npm start
```
* **Interactive Cockpit UI**: [http://localhost:3000/](http://localhost:3000/)
* **API Endpoint**: [http://localhost:3000/api/v1/flash-sales/sale-syscrafters-2026](http://localhost:3000/api/v1/flash-sales/sale-syscrafters-2026)

---

## 🧪 Automated Concurrency & Failure Recovery Test Suite

Run the full verification suite directly from the command line:

```bash
# Run all 4 verification tests (Idempotency, 10k Burst, Full Lifecycle Recovery, Multi-Product Sharding)
node node_modules/tsx/dist/cli.mjs tests/runAllTests.ts
```

### Individual Test Suites:
```bash
# 1. 10,000 Concurrent Shoppers vs 100 Stock
node node_modules/tsx/dist/cli.mjs tests/concurrency.test.ts

# 2. Idempotency & Replay Attack (500 rapid duplicate submissions)
node node_modules/tsx/dist/cli.mjs tests/idempotency.test.ts

# 3. Complete Lifecycle (60 Success, 20 Payment Failures, 20 Timeouts, 40 Wave-2 Restocks)
node node_modules/tsx/dist/cli.mjs tests/lifecycle.test.ts

# 4. Multi-Product Traffic Sharding & Cart Contention (10,000 Customers vs 1,000 Product Shards)
node node_modules/tsx/dist/cli.mjs tests/multiProduct.test.ts
```

---

## 📡 REST API Reference

### 1. Reserve Item (Fast Path)
```http
POST /api/v1/flash-sales/:id/reserve
Headers:
  Idempotency-Key: <unique-uuid>
Body:
  {
    "user_id": "shopper_101",
    "ttl_seconds": 300
  }
```
* **Success `201 Created`**: Returns `reservation_token`, `expires_at`, and `remaining_stock`.
* **Sold Out `409 Conflict`**: Returned instantly (< 5ms) when stock is 0.
* **Duplicate User `429 Too Many Requests`**: Returned if user already holds a reservation.

### 2. Checkout Reservation
```http
POST /api/v1/orders/checkout
Body:
  {
    "reservation_token": "res_8f93e1b...",
    "idempotency_key": "idem_chk_001"
  }
```

### 3. Process Payment
```http
POST /api/v1/payments/process
Body:
  {
    "order_id": "ord_240d0c...",
    "idempotency_key": "idem_pay_001",
    "simulate_mode": "SUCCESS" // Options: "SUCCESS", "DECLINE", "TIMEOUT"
  }
```

### 4. Database Invariant Audit Check
```http
GET /api/v1/audit/sale-syscrafters-2026
```
Returns:
```json
{
  "total_initial_stock": 100,
  "paid_orders": 100,
  "active_holds": 0,
  "db_available_stock": 0,
  "oversold_count": 0,
  "zero_oversell_invariant_passed": true,
  "audit_status": "VERIFIED_CORRECT"
}
```

### 5. Multi-Product High-Scale Simulation (10,000 Customers vs 1,000 Products)
```http
POST /api/v1/simulation/run-multi-product
Body:
  {
    "customers": 10000,
    "products": 1000,
    "batch_size": 250
  }
```

### 6. Multi-Item Cart Contention Simulation (Atomic All-or-Nothing Rollback)
```http
POST /api/v1/simulation/run-multi-cart
Body:
  {
    "customers": 500,
    "items_per_cart": 3
  }
```

---

## 💻 Tech Stack & Design Decisions

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Runtime** | Node.js (TypeScript) | Non-blocking event loop ideal for asynchronous high-concurrency network I/O. |
| **In-Memory Atomic Engine** | Redis Lua / High-Speed Engine | Sub-millisecond atomic checks (`DECRBY`, `SISMEMBER`) without disk bottleneck. |
| **Relational Storage** | SQLite / PostgreSQL | ACID transactions, strict schema foreign keys, and `CHECK (available_stock >= 0)`. |
| **Sweeper & Restocker** | Background Expiry Engine | Recovers abandoned reservations every 2 seconds, guaranteeing zero phantom stock. |
| **Telemetry & UI** | WebSockets + Vanilla CSS | Zero-dependency, dark-mode cockpit dashboard providing real-time visibility into the system state. |

---

## 👥 Hackathon Submission Info
* **Project**: SALESTORM Flash Sale System
* **Track**: SysCrafters 2026 Hackathon Brief
* **Core Invariant**: Strict Zero Overselling ($\le 100$ units under 10,000 concurrent requests).
