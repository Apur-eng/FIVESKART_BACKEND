# FIVESKART_BACKEND

# NexityTec Backend (BAP) — Complete Production Backend Audit Report

**Project:** NexityTec Backend (`nexitytec-bap`)  
**Repository Source:** Live Production VPS Snapshot  
**Audit Type:** Non-Destructive Static Analysis & Production Readiness Assessment  
**Date:** September 2026  

---

## 1. EXECUTIVE SUMMARY

The NexityTec backend (`nexitytec-bap`) is designed as a **Beckn Application Platform (BAP)** protocol adapter/client, specifically tailored for EV charging network discovery and fulfillment under the Beckn protocol (integrating with networks such as 2ChargeEV).

The codebase is currently in an **early-stage skeleton/stub state**. While core cryptographic signing for outgoing Beckn requests (Ed25519 with BLAKE-512 hashing) is functional, the service has **severe architectural, security, operational, and protocol compliance gaps** that make it unsafe and non-viable for production in its current form:

1. **Critical Security Vulnerabilities:**
   - **Open Relay & Signature Oracle:** The outgoing `POST /search` endpoint requires zero authentication. Any internet actor can call this endpoint to trigger Beckn searches signed with NexityTec's private cryptographic identity.
   - **Lack of Webhook Verification:** None of the Beckn callback endpoints (`/on_search`, `/on_select`, `/on_init`, `/on_confirm`, `/on_status`) verify incoming cryptographic signatures or validate sender identity. The system unconditionally returns an `ACK` status without validating whether the payload originated from an authorized Beckn Gateway or BPP.
   - **Credential Exposure Risks:** An unencrypted private key file (`keys/beckn_private_key.pem`) is located inside the repository tree and is **not ignored** by `.gitignore`. Furthermore, a debug script (`test-key.js`) prints this private key directly to standard output.
   - **Information Leakage:** Outgoing search responses echo the complete cryptographic `Authorization` header, and error handlers expose upstream network and gateway diagnostics directly to API callers.

2. **Total Absence of Persistence Layer:**
   - There is no database, cache, or message queue. Incoming Beckn callbacks (`/on_*`) log raw payloads to `stdout` via `console.dir` and immediately discard them in memory.
   - Because state is not persisted, outgoing requests (`transaction_id`, `message_id`) cannot be correlated with incoming asynchronous responses.

3. **Performance & Event-Loop Blockers:**
   - The private key is read synchronously from disk (`fs.readFileSync`) and parsed into an OpenSSL `KeyObject` (`crypto.createPrivateKey`) on **every single incoming search request**, blocking the single-threaded Node.js event loop.
   - Incoming callbacks execute synchronous, unbounded object logging (`console.dir(req.body, { depth: null })`), creating a direct CPU-exhaustion Denial-of-Service (DoS) vector.
   - External Axios calls have no configured request timeouts or connection pooling (Keep-Alive).

4. **Protocol Mismatch:**
   - The BAP URI advertised in the Beckn context is `${BAP_BASE_URL}/beckn`, but routes are mounted at the root `/` in Express. Unless an external reverse proxy rewrites path prefixes, incoming callbacks to `/beckn/on_*` will fail with HTTP 404.
   - Non-canonical JSON serialization (`JSON.stringify`) is used to construct the BLAKE-512 digest, creating interoperability failure risks with Beckn Gateways.

---

## 2. ARCHITECTURE MAP

### Component Overview

```
+----------------------------------------------------------------------------------------------------+
|                                         CLIENT / CONSUMER                                          |
+----------------------------------------------------------------------------------------------------+
              |                                                                        ^
              | 1. POST /search (Unauthenticated)                                      | 6. HTTP 200 (echoes payload,
              v                                                                        |    auth header, gateway resp)
+----------------------------------------------------------------------------------------------------+
| EXPRESS HTTP SERVER (Port: process.env.PORT || 3002)                                               |
|                                                                                                    |
|  [Middleware]                                                                                      |
|   └── express.json({ limit: "10mb" })  <-- Missing: Helmet, CORS, RateLimit, Auth, ErrorHandler   |
|                                                                                                    |
|  [Routes]                                                                                          |
|   ├── GET  /health           --> Inline Controller                                                 |
|   ├── POST /search           --> becknController.search                                            |
|   ├── POST /on_search        --> becknController.onSearch   <-- [STUB: Logs to stdout, drops data] |
|   ├── POST /on_select        --> becknController.onSelect   <-- [STUB: Logs to stdout, drops data] |
|   ├── POST /on_init          --> becknController.onInit     <-- [STUB: Logs to stdout, drops data] |
|   ├── POST /on_confirm       --> becknController.onConfirm  <-- [STUB: Logs to stdout, drops data] |
|   └── POST /on_status        --> becknController.onStatus   <-- [STUB: Logs to stdout, drops data] |
+----------------------------------------------------------------------------------------------------+
              |
              | 2. search() calls sendSearch(payload)
              v
+----------------------------------------------------------------------------------------------------+
| SERVICES LAYER                                                                                     |
|                                                                                                    |
|  [becknClient.js]                                                                                  |
|   └── sendSearch()                                                                                 |
|        │                                                                                           |
|        ├── 3. createAuthorizationHeader(payload)                                                   |
|        │       └── becknAuth.js:                                                                   |
|        │            ├── getPrivateKeyObject()                                                      |
|        │            │    └── [DISK I/O] fs.readFileSync(process.env.BAP_PRIVATE_KEY_PATH)        |
|        │            │    └── [CPU] crypto.createPrivateKey()                                       |
|        │            ├── blake.blake2b() (BLAKE-512 Digest)                                         |
|        │            └── crypto.sign(null, signingString, privateKey) (Ed25519)                     |
|        │                                                                                           |
|        └── 4. axios.post(process.env.BECKN_GATEWAY_URL, payload, { headers })                      |
|                 (No HTTP timeout, no Keep-Alive agent configured)                                  |
+----------------------------------------------------------------------------------------------------+
              |
              | 5. External HTTP POST
              v
+----------------------------------------------------------------------------------------------------+
| EXTERNAL BECKN GATEWAY (Default: http://127.0.0.1:5001/search)                                     |
+----------------------------------------------------------------------------------------------------+
```

### Callback Ingestion Flow (Beckn Network -> BAP)

```
+----------------------------------------------------------------------------------------------------+
| BECKN GATEWAY / BPP (External Network)                                                             |
+----------------------------------------------------------------------------------------------------+
              |
              | POST /on_search, /on_select, /on_init, /on_confirm, /on_status
              v
+----------------------------------------------------------------------------------------------------+
| EXPRESS ROUTER (routes/beckn.routes.js)                                                            |
|   └── Missing: Authorization header verification                                                   |
|   └── Missing: Registry public key verification                                                    |
|   └── Missing: Payload schema validation                                                           |
+----------------------------------------------------------------------------------------------------+
              |
              v
+----------------------------------------------------------------------------------------------------+
| CONTROLLER LAYER (controllers/beckn.controller.js)                                                 |
|   └── console.dir(req.body, { depth: null })  <-- [BLOCKING EVENT LOOP]                            |
|   └── Return { message: { ack: { status: "ACK" } } }                                               |
|   └── DATA IS DROPPED (No Database / No Cache / No Queue)                                          |
+----------------------------------------------------------------------------------------------------+
```

### Component Dependency Graph

- `server.js`
  └── `dotenv.config()`
  └── `app.js`
       ├── `express.json({ limit: "10mb" })`
       └── `routes/beckn.routes.js`
            └── `controllers/beckn.controller.js`
                 ├── `crypto.randomUUID()`
                 └── `services/becknClient.js`
                      ├── `axios`
                      └── `services/becknAuth.js`
                           ├── `fs`, `path`, `crypto`
                           ├── `blakejs`
                           └── Reads `keys/beckn_private_key.pem` synchronously

**Unused / Disconnected Components:**
- `services/registryLookup.js`: Defined but never imported or called.
- `utils/logger.js`: 0 bytes, empty stub.
- `test-key.js`: Standalone scratch script.
- `uuid` package: Installed in `package.json` but never imported (`crypto.randomUUID()` is used).

---

## 3. COMPLETE API INVENTORY

| Method | Endpoint | Auth Required | Role / Scope | Input Validation | DB Access | External API Calls | Risk Level |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | No | Public | None | None | None | **LOW** |
| `POST` | `/search` | No | Public | None (optional fallback) | None | Beckn Gateway (`POST` to `BECKN_GATEWAY_URL`) | **CRITICAL** |
| `POST` | `/on_search` | No (Missing Beckn Auth) | Public / Webhook | None | None (Dropped) | None | **HIGH** |
| `POST` | `/on_select` | No (Missing Beckn Auth) | Public / Webhook | None | None (Dropped) | None | **HIGH** |
| `POST` | `/on_init` | No (Missing Beckn Auth) | Public / Webhook | None | None (Dropped) | None | **HIGH** |
| `POST` | `/on_confirm`| No (Missing Beckn Auth) | Public / Webhook | None | None (Dropped) | None | **HIGH** |
| `POST` | `/on_status` | No (Missing Beckn Auth) | Public / Webhook | None | None (Dropped) | None | **HIGH** |

### Endpoint Breakdown

#### 1. `GET /health`
- **Controller:** Inline in `app.js`
- **Input Parameters:** None
- **Response Format:** `200 OK` `{"success": true, "message": "BAP server is running"}`
- **Defects:** Does not check downstream gateway connectivity, key loading readiness, or system memory.

#### 2. `POST /search`
- **Controller:** `controllers/beckn.controller.js:search`
- **Service:** `services/becknClient.js:sendSearch` -> `services/becknAuth.js:createAuthorizationHeader`
- **Input Parameters:** JSON body: `{ "domain": string, "city": string }` (optional)
- **Payload Construction:** Builds Beckn v1.1.0 search intent with hardcoded `"EV_CHARGING"`, `"Delivery"` fulfillment, and `"ON-FULFILLMENT"` payment.
- **Response Format:**
  ```json
  {
    "success": true,
    "message": "Beckn search sent successfully",
    "payload": { "context": {...}, "message": {...} },
    "authorization": "Signature keyId=...",
    "gatewayResponse": {...}
  }
  ```
- **Error Response:** `500 Internal Server Error` `{"success": false, "message": "Failed to send Beckn search", "error": {...}}`
- **Vulnerabilities:**
  - Open relay / signature oracle (anyone can generate valid signatures signed by NexityTec's key).
  - Leaks signed authorization header and upstream gateway error diagnostics.
  - Blocking synchronous disk I/O on key parsing.
  - No request timeout on Axios call.

#### 3. `POST /on_search`, `POST /on_select`, `POST /on_init`, `POST /on_confirm`, `POST /on_status`
- **Controllers:** `controllers/beckn.controller.js` (`onSearch`, `onSelect`, `onInit`, `onConfirm`, `onStatus`)
- **Input Parameters:** Arbitrary JSON body (up to 10MB)
- **Response Format:** `200 OK` `{"message": {"ack": {"status": "ACK"}}}`
- **Error Response:** In `onSearch`: `500 Internal Server Error` `{"message": {"ack": {"status": "NACK"}}, "error": {"message": "..."}}`. In other callbacks: Unhandled (default Express 5 HTML error).
- **Vulnerabilities:**
  - Completely unverified endpoints accepting fake callback events from any IP address.
  - `console.dir(req.body, { depth: null })` creates an event loop freeze under deep/large JSON payloads.
  - No database storage; callback data is permanently lost immediately upon returning `ACK`.

---

## 4. SECURITY FINDINGS

### Summary Table

| Finding ID | Severity | File & Location | Vulnerability Category |
| :--- | :--- | :--- | :--- |
| **SEC-001** | **CRITICAL** | `controllers/beckn.controller.js:39-59` | Open Relay / Signature Oracle |
| **SEC-002** | **CRITICAL** | `keys/beckn_private_key.pem:1-3`, `.gitignore:1-144` | Insecure Credential Storage & Git Leak Risk |
| **SEC-003** | **HIGH** | `controllers/beckn.controller.js:61-127` | Unauthenticated Webhook Ingestion / Spoofing |
| **SEC-004** | **HIGH** | `test-key.js:5` | Secret Printed to Standard Output |
| **SEC-005** | **HIGH** | `app.js:6`, `controllers/beckn.controller.js:64,95,104,113,122` | Denial of Service via Deep JSON & Event Loop Blocking |
| **SEC-006** | **MEDIUM** | `services/registryLookup.js:11` | URL Injection / Potential SSRF in Registry Lookup |
| **SEC-007** | **MEDIUM** | `app.js:4-6` | Missing HTTP Security Headers & Fingerprinting (Helmet / CORS) |
| **SEC-008** | **MEDIUM** | `controllers/beckn.controller.js:48,56,87` | Information Disclosure in API Responses & Errors |
| **SEC-009** | **LOW** | `routes/beckn.routes.js:6-13` | Total Absence of Rate Limiting |

---

### Detailed Findings

#### SEC-001 — Open Relay & Signature Oracle on `/search`
- **Severity:** **CRITICAL**
- **File:** `controllers/beckn.controller.js:39-59`
- **Problem:** The `POST /search` endpoint has no authentication mechanism (no API key, JWT, IP allowlist, or session verification). When invoked, it generates a Beckn payload containing NexityTec's registered `bap_id` (`bap.nexitytec.cloud`), signs it using the Ed25519 private key, and transmits it to the Beckn gateway.
- **Why It Matters:** An attacker on the internet can use this endpoint as an open signing proxy. They can trigger high volumes of signed search requests into the Beckn/ONDC network, impersonating NexityTec, exhausting rate limits with the Beckn gateway, or weaponizing the server in denial-of-service campaigns against downstream BPPs.
- **Theoretical Exploit Scenario:** An unauthorized client repeatedly issues POST requests to `https://bap.nexitytec.cloud/search` with rotating parameters. The server signs each request with NexityTec's official Ed25519 key and sends them to the gateway, flooding downstream networks under NexityTec's authenticated identity.
- **Recommended Fix:** Protect `POST /search` with client authentication (e.g., API key header or internal service JWT), or restrict access via a private VPC / reverse proxy allowlist.

#### SEC-002 — Insecure Credential Storage & Git Leak Risk
- **Severity:** **CRITICAL**
- **File:** `keys/beckn_private_key.pem` and `.gitignore`
- **Problem:**
  - `SECRET FOUND IN keys/beckn_private_key.pem:1-3`
  - The Ed25519 private key is stored as a plaintext PEM file in the repository tree.
  - `.gitignore` does **not** include `keys/`, `*.pem`, or `*.key`.
- **Why It Matters:** If this repository is committed and pushed to GitHub (configured as `git+https://github.com/singhaps57/nexitytec-bap.git` in `package.json`), the organization's official Beckn private signing key will be leaked into public or shared version control, compromising cryptographic identity across the entire Beckn ecosystem.
- **Recommended Fix:**
  1. Add `keys/` and `*.pem` to `.gitignore`.
  2. Load the private key from a secure secret store (e.g., AWS Secrets Manager, HashiCorp Vault) or inject via an environment variable (`BAP_PRIVATE_KEY_BASE64`) rather than storing plaintext key files in the codebase.
  3. Ensure file permissions on the production host are locked down (`chmod 600`).

#### SEC-003 — Unauthenticated Webhook Ingestion & Spoofing on `/on_*` Callbacks
- **Severity:** **HIGH**
- **File:** `controllers/beckn.controller.js:61-127`
- **Problem:** All Beckn callback endpoints (`/on_search`, `/on_select`, `/on_init`, `/on_confirm`, `/on_status`) accept payloads without validating the Beckn `Authorization` header. Line 67 contains `// TODO: 1. verify signature if needed`.
- **Why It Matters:** Any third party can send fabricated charging quotes, fake EV charger statuses, or fraudulent order confirmations (`/on_confirm`) to the BAP server. When database integration is added later, unverified callbacks will poison the database with falsified data.
- **Theoretical Exploit Scenario:** An attacker POSTs a falsified `/on_confirm` or `/on_status` payload claiming an EV charging session was completed or failed. The BAP acknowledges the payload as legitimate without verifying that it originated from a registered BPP.
- **Recommended Fix:** Implement an incoming Beckn signature verification middleware that extracts the sender's `keyId`, retrieves the public key from the Beckn Registry (or cache), verifies the BLAKE-512 digest of the raw body, and validates the Ed25519 signature before routing to controllers.

#### SEC-004 — Secret Printed to Standard Output in Scratch Script
- **Severity:** **HIGH**
- **File:** `test-key.js:5`
- **Problem:**
  - `SECRET FOUND IN test-key.js:5`
  - The script reads the private key and calls `console.log(pem)`.
- **Why It Matters:** If this script is executed in automated test pipelines, container builds, or production terminal sessions, the raw cryptographic private key will be emitted to system logs, CI/CD output consoles, and terminal history.
- **Recommended Fix:** Remove `console.log(pem)` immediately and isolate or delete scratch test scripts from production directories.

#### SEC-005 — Denial of Service via Deep JSON & Event Loop Blocking
- **Severity:** **HIGH**
- **File:** `app.js:6`, `controllers/beckn.controller.js:64,95,104,113,122`
- **Problem:**
  1. `app.use(express.json({ limit: "10mb" }))` allows massive payloads on all routes.
  2. Every callback controller executes `console.dir(req.body, { depth: null })`.
- **Why It Matters:** Node.js runs on a single-threaded event loop. Parsing up to 10MB of nested JSON followed by `console.dir` traversing the entire tree with `{ depth: null }` blocks the event loop for hundreds of milliseconds or seconds, halting all other traffic and causing timeout cascades.
- **Recommended Fix:** Lower body limit to `256kb` (typical Beckn payloads are under 50KB), replace `console.dir` with structured, level-filtered logging (e.g., Pino), and do not dump entire payload trees in production.

#### SEC-006 — URL Injection / Potential SSRF in Registry Lookup
- **Severity:** **MEDIUM**
- **File:** `services/registryLookup.js:11`
- **Problem:**
  ```javascript
  const url = `${REGISTRY_LOOKUP_URL}/${subscriberId}/${uniqueKeyId}`;
  ```
  `subscriberId` and `uniqueKeyId` are interpolated directly into the URL path without `encodeURIComponent()`.
- **Why It Matters:** If these values are derived from incoming request headers or untrusted context, path traversal characters (`../`) or query separators (`?`, `#`) can alter the destination URL or cause SSRF if the lookup base URL is misconfigured.
- **Recommended Fix:** Always sanitize and encode path segments using `encodeURIComponent(subscriberId)` and `encodeURIComponent(uniqueKeyId)`.

#### SEC-007 — Missing HTTP Security Headers & Express Fingerprinting
- **Severity:** **MEDIUM**
- **File:** `app.js:4-6`
- **Problem:** The Express application does not use `helmet` or `cors`. It emits default headers including `X-Powered-By: Express` and lacks `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, and `Strict-Transport-Security`.
- **Why It Matters:** Exposes framework version metadata to attackers and fails baseline security compliance standards.
- **Recommended Fix:** Install `helmet` and configure `app.use(helmet())`. Add explicit CORS configuration if accessed by web clients.

#### SEC-008 — Information Disclosure in API Responses & Errors
- **Severity:** **MEDIUM**
- **File:** `controllers/beckn.controller.js:48,56,87`
- **Problem:**
  - Line 48 returns the raw `authorization` header in the search response.
  - Line 56 returns `error: error.response?.data || error.message` in 500 responses.
  - Line 87 returns internal `error.message` in callback responses.
- **Why It Matters:** Upstream network errors, connection strings, gateway internal response codes, and infrastructure hostnames are exposed to untrusted clients.
- **Recommended Fix:** Return generic client-facing error messages in production and record detailed diagnostic errors in secure server-side logs.

#### SEC-009 — Total Absence of Rate Limiting
- **Severity:** **LOW** (Compounding factor for SEC-001)
- **File:** `routes/beckn.routes.js:6-13`
- **Problem:** No rate limiting is configured on any endpoint.
- **Why It Matters:** The `/search` endpoint performs cryptographic signing and an outbound HTTP call; without rate limiting, it is susceptible to resource starvation.
- **Recommended Fix:** Add `express-rate-limit` backed by Redis or an in-memory store.

---

## 5. DATABASE FINDINGS

### Status: Complete Absence of Data Persistence Layer

1. **No Database Driver or ORM Configured:**
   - The repository contains no database dependencies (`pg`, `mysql2`, `mongodb`, `prisma`, `typeorm`, `sequelize`, or `mongoose`).
   - No database configuration, migrations, models, or connection pools exist.

2. **Critical Functional Consequence — Asynchronous Callback Loss:**
   - The Beckn protocol is asynchronous by design:
     - Client calls `POST /search` -> Gateway responds with synchronous `ACK`.
     - Later, BPPs send one or more `POST /on_search` callbacks containing available EV charging stations, rates, and slots.
   - In this codebase, `controllers/beckn.controller.js:66-70` acknowledges:
     ```javascript
     // TODO:
     // 1. verify signature if needed
     // 2. save providers/items/quotes into DB
     // 3. map to your 2ChargeEV charger list response
     ```
   - Because incoming data is not stored in a database or Redis cache, **all EV charger search results, quotes, and confirmations received from the network are immediately lost**.
   - A frontend or mobile app calling `POST /search` cannot retrieve results via polling or WebSockets because there is no transaction record linking `transaction_id` to received items.

3. **Data Integrity & Concurrency Concerns for Future Implementation:**
   - **Transaction Idempotency:** Beckn networks frequently retry callbacks on network timeouts. The system lacks idempotency keys or transaction state tables to prevent duplicate processing of `/on_confirm`.
   - **Race Conditions:** Asynchronous callbacks from multiple BPPs arrive concurrently for the same `transaction_id`. Without atomic database operations or distributed locks, race conditions will occur during provider aggregation.

---

## 6. PERFORMANCE FINDINGS

### 1. Synchronous Disk I/O & Key Parsing on Every Request
- **Location:** `services/becknAuth.js:9-34, 52`
- **Code:**
  ```javascript
  function createAuthorizationHeader(payload, ttlSeconds = 300) {
    const privateKey = getPrivateKeyObject();
    ...
  }
  function getPrivateKeyObject() {
    ...
    const pem = fs.readFileSync(keyPath, "utf8");
    return crypto.createPrivateKey({ key: pem, format: "pem" });
  }
  ```
- **Bottleneck:** `fs.readFileSync` performs synchronous file I/O, and `crypto.createPrivateKey` performs synchronous ASN.1/DER parsing on the single-threaded Node.js event loop on **every search request**.
- **Impact:** Under 20-50 concurrent requests, response latency will spike and throughput will degrade severely.
- **Remediation:** Load and parse the private key once during application initialization, caching the resulting `KeyObject` in memory.

### 2. Blocking Object Serialization in `console.dir`
- **Location:** `controllers/beckn.controller.js:64, 95, 104, 113, 122`
- **Code:** `console.dir(req.body, { depth: null });`
- **Bottleneck:** Recursively formatting deeply nested JSON objects without depth limits blocks V8's main thread.
- **Remediation:** Remove `console.dir` and use non-blocking asynchronous structured loggers.

### 3. Missing HTTP Connection Pooling (Keep-Alive) & Timeouts
- **Location:** `services/becknClient.js:14`
- **Code:** `const response = await axios.post(BECKN_GATEWAY_URL, payload, { headers });`
- **Bottleneck:**
  - No `http.Agent` or `https.Agent` with `keepAlive: true` is provided. A new TCP handshake (and TLS negotiation if HTTPS) must occur for every outbound gateway request.
  - No `timeout` parameter is specified in the Axios request. If the Beckn gateway hangs or drops packets, the Node.js socket remains open indefinitely until the OS TCP timeout fires, exhausting socket file descriptors.
- **Remediation:** Create a dedicated Axios instance with `keepAlive: true`, `maxSockets: 100`, and a strict timeout (e.g., `timeout: 5000`).

### 4. Non-Deterministic JSON Stringification in Cryptographic Digest
- **Location:** `services/becknAuth.js:36-38, 41`
- **Code:**
  ```javascript
  function stableStringify(obj) {
    return JSON.stringify(obj);
  }
  ```
- **Bottleneck / Risk:** Standard `JSON.stringify` does not guarantee deterministic key ordering. If keys are serialized in different orders between client and gateway, the BLAKE-512 hash will mismatch, causing intermittent signature rejections.
- **Remediation:** Use a deterministic canonical serializer such as `fast-json-stable-stringify`.

---

## 7. CODE QUALITY FINDINGS

### 1. Route Mounting Path Mismatch (`/` vs `/beckn`)
- **Location:** `app.js:12` vs `controllers/beckn.controller.js:15`
- **Issue:** The search payload advertises:
  `bap_uri: "${process.env.BAP_BASE_URL}/beckn"`
  However, `app.js` mounts the routes as:
  `app.use("/", becknRoutes);`
  The endpoints are listening on `/on_search`, `/on_select`, etc., NOT `/beckn/on_search`. If the Beckn gateway sends callbacks to `${bap_uri}/on_search`, Express will return a `404 Not Found` unless an external Nginx rewrite rule exists.
- **Remediation:** Align route mounting: `app.use("/beckn", becknRoutes)` or update `bap_uri` to match the exact mounted path.

### 2. Dead Code & Unused Modules
- `services/registryLookup.js`: Entire file is dead code; `lookupSubscriber` is never imported anywhere.
- `utils/logger.js`: 0 bytes, empty stub.
- `test-key.js`: Scratch script left in project root.
- `uuid` package: Included in `package.json` dependencies but unused (`crypto.randomUUID()` is used instead).

### 3. Module-Load-Time Environment Variable Caching
- **Location:** `services/becknAuth.js:6-7`, `services/becknClient.js:4`
- **Issue:** Constants such as `BAP_SUBSCRIBER_ID = process.env.BAP_SUBSCRIBER_ID` are evaluated once when the module is required. If `app.js` is imported in a test environment or secondary worker before `dotenv.config()` is executed, these variables will remain `undefined` permanently due to Node's module caching.
- **Remediation:** Centralize configuration in a `config/` module that validates and exports loaded environment variables.

### 4. Fragile Relative Path Resolution (`process.cwd()`)
- **Location:** `services/becknAuth.js:16`
- **Issue:** `path.resolve(process.cwd(), rawPath)`. If the Node process is started from any directory other than the project root (e.g. `pm2 start /var/www/nexitytec-bap/server.js` from `/root`), `process.cwd()` points to the wrong directory and key loading throws an error.
- **Remediation:** Use `path.resolve(__dirname, "..", rawPath)` or mandate absolute paths.

### 5. Inconsistent Error Handling
- In `search` and `onSearch`, `try/catch` blocks are used.
- In `onSelect`, `onInit`, `onConfirm`, and `onStatus`, there are **no try/catch blocks**. Any unexpected exception will trigger default Express 5 error handling.

### 6. Hardcoded Domain and Fulfillment Types
- **Location:** `controllers/beckn.controller.js:9,11,24`
- **Issue:** `domain: input.domain || "nic2004:60232"`, `city: input.city || "std:0522"`, and `fulfillment: { type: "Delivery" }`. For an EV charging service, `"Delivery"` is invalid; Beckn EV charging protocols typically use `"CHARGING"` or `"STATION"`.

---

## 8. DEPENDENCY AUDIT

### Dependency Inventory

| Package | Declared Version | Resolved Version | Classification | Assessment & Action Required |
| :--- | :--- | :--- | :--- | :--- |
| `express` | `^5.2.1` | `5.2.1` | **INFORMATIONAL** | Express v5 has native async error handling. Safe, but ensure body parsing errors are intercepted. |
| `axios` | `^1.18.1` | `1.18.1` | **MEDIUM** | Functional HTTP client. Must configure strict timeouts and Keep-Alive agents. |
| `blakejs` | `^1.2.1` | `1.2.1` | **LOW** | Pure JavaScript BLAKE2b implementation. Slower than native C++ bindings under high load, but functionally correct. |
| `dotenv` | `^17.4.2` | `17.4.2` | **LOW** | Used for environment variable injection. |
| `uuid` | `^14.0.1` | `14.0.1` | **INFORMATIONAL** | **Unused dependency.** Node.js `crypto.randomUUID()` is used instead. Can be safely removed. |

### Missing Critical Production Packages
1. `helmet` — Essential HTTP security headers.
2. `cors` — Cross-Origin Resource Sharing control.
3. `express-rate-limit` — Rate limiting and brute-force mitigation.
4. `zod` or `joi` — Schema validation for incoming and outgoing payloads.
5. `pino` or `winston` — Production-grade structured logging.
6. `fast-json-stable-stringify` — Canonical JSON hashing for Beckn compliance.

---

## 9. DEPLOYMENT & OBSERVABILITY FINDINGS

### 1. Process Management & Clustering
- No PM2 configuration (`ecosystem.config.js`), Dockerfile, or systemd service unit exists in the repository.
- The service runs as a single Node.js process without cluster mode. On a multi-core VPS, CPU resources are underutilized.

### 2. Missing Graceful Shutdown
- `server.js` calls `app.listen()` but registers no handlers for `SIGTERM` or `SIGINT`.
- During deployments or server restarts, active HTTP connections will be abruptly terminated rather than draining gracefully.

### 3. Unhandled Global Errors
- Neither `server.js` nor `app.js` attaches listeners for `process.on("unhandledRejection")` or `process.on("uncaughtException")`.
- Any unhandled asynchronous rejection can crash the process or leave it in an unpredictable state.

### 4. Health Check Observability
- The `/health` endpoint returns a hardcoded static JSON object `{ success: true, message: "BAP server is running" }`.
- It does not verify whether the private key is validly loaded, whether the external gateway is reachable, or whether memory usage is within thresholds.

### 5. Logging Deficiencies
- `utils/logger.js` is empty (0 bytes).
- Standard `console.log` and `console.error` lack timestamps, log levels, request correlation IDs, and structured JSON formatting necessary for log aggregation systems.

---

## 10. ENVIRONMENT VARIABLE AUDIT

> **Security Note:** In compliance with security standards, actual secret values are omitted.

| Variable Name | Defined In Code / File | Required? | Hardcoded Fallback | Security Concern & Usage Assessment |
| :--- | :--- | :--- | :--- | :--- |
| `PORT` | `server.js:4` | No | `3002` | Port binding. Standard configuration. |
| `NODE_ENV` | `.env:2` | No | None | Set to `development` in `.env`. Must be `production` on live VPS to prevent verbose error leakage. |
| `BAP_SUBSCRIBER_ID` | `beckn.controller.js:14`, `becknAuth.js:6` | **Yes** | None | BAP identity registered with Beckn registry. Crucial for key identification. |
| `BAP_UNIQUE_KEY_ID` | `becknAuth.js:7` | **Yes** | None | Keypair identifier registered with Beckn registry. Required for signature verification. |
| `BAP_BASE_URL` | `beckn.controller.js:15` | **Yes** | None | Public URL of this BAP. Note: concatenated with `/beckn` in controller but routes are at `/`. |
| `BAP_PRIVATE_KEY_PATH` | `becknAuth.js:10` | **Yes** | None | Path to private key file. If relative, depends on `process.cwd()`. File exists on disk. |
| `BAP_PUBLIC_KEY_PATH` | `.env:11` | No (Unused) | None | Defined in `.env` but file does not exist in `keys/` and is never read in code. |
| `BECKN_GATEWAY_URL` | `becknClient.js:4` | **Yes** | None | Set to `http://127.0.0.1:5001/search` in `.env`. Unencrypted HTTP pointing to localhost. |
| `REGISTRY_LOOKUP_URL` | `registryLookup.js:3` | No (Unused) | None | URL for Beckn subscriber lookup. Currently unused because signature verification is unbuilt. |

---

## 11. BUSINESS LOGIC & BECKN PROTOCOL AUDIT

### 1. Beckn State Machine Gaps
The Beckn protocol defines a strict multi-step discovery and transaction lifecycle:
```
1. search  --> on_search   (Catalog discovery / charging stations)
2. select  --> on_select   (Quote generation / slot selection)
3. init    --> on_init     (Order initialization / billing details)
4. confirm --> on_confirm  (Order placement / charging activation)
5. status  --> on_status   (Session monitoring / battery state)
```
- **Finding:** The application implements outgoing `search`, but has **zero outgoing implementations** for `select`, `init`, `confirm`, or `status`.
- **Impact:** The BAP cannot execute any transaction beyond initial catalog queries. Users cannot select a charger, initialize an order, or confirm an EV charging session.

### 2. Intent & Fulfillment Mismatch for EV Charging
- In `controllers/beckn.controller.js:23-34`:
  ```javascript
  fulfillment: { type: "Delivery" },
  category: { descriptor: { code: "EV_CHARGING" } },
  payment: { type: "ON-FULFILLMENT" }
  ```
- In Beckn EV charging schemas (UEI / Unified Energy Interface), fulfillment is location-bound charging (`"IN_PERSON"` or `"CHARGING"`), not `"Delivery"`. Sending `"Delivery"` may cause upstream BPP gateways to reject the search intent as invalid.

### 3. Gateway Configuration Risk
- In `.env:14`, `BECKN_GATEWAY_URL` is set to `http://127.0.0.1:5001/search`.
- If the Beckn gateway is not running locally on port 5001 of the production VPS, all search calls will immediately fail with `ECONNREFUSED`.

---

## 12. TEST COVERAGE GAPS

### Current State: 0% Automated Test Coverage
- There are no unit tests, integration tests, or end-to-end tests.
- No testing framework (`jest`, `mocha`, `vitest`) is installed in `package.json`.
- The only test-related file is `test-key.js`, which is a manual check script that leaks the private key to stdout.

### Recommended Priority Test Suites to Implement

1. **Cryptographic Signing Unit Tests:**
   - Test `createBlake512Digest` with known test vectors against official Beckn specifications.
   - Verify that Ed25519 signature generated with private key validates against the corresponding public key.
   - Verify deterministic JSON ordering during digest generation.

2. **Incoming Signature Verification Tests:**
   - Test callback authorization header parsing.
   - Verify rejection of expired signatures (`expires < now`).
   - Verify rejection of forged signatures or tampered request bodies.

3. **Controller & Route Integration Tests (Supertest):**
   - Verify `GET /health` returns 200.
   - Verify `POST /search` validates input parameters and handles gateway errors without crashing.
   - Verify `POST /on_*` callback routes return ACK on valid input and reject oversized or malformed payloads.

4. **Error Handling & Failure Mode Tests:**
   - Verify application behavior when `BECKN_GATEWAY_URL` is unreachable (timeout / network error).
   - Verify application behavior when private key file is missing or corrupted.

---

## 13. PRIORITY REMEDIATION PLAN

### PHASE 1 — Immediate Security Fixes (Deploy Within 24-48 Hours)
1. **Secure Private Key Storage & Gitignore:**
   - Add `keys/` and `*.pem` to `.gitignore`.
   - Restrict filesystem permissions on `keys/beckn_private_key.pem` to `600` on the VPS.
   - **Files:** `.gitignore`
   - **Risk:** Low. **Downtime:** None.
2. **Remove Key-Logging Debug Script:**
   - Delete or sanitize `test-key.js` to prevent private key emission.
   - **Files:** `test-key.js`
   - **Risk:** Zero. **Downtime:** None.
3. **Restrict Access to `/search` (Close Open Relay):**
   - Add an API key middleware or restrict `POST /search` to internal IP addresses/reverse proxy.
   - Stop echoing the signed `Authorization` header in the API response.
   - **Files:** `routes/beckn.routes.js`, `controllers/beckn.controller.js`
   - **Risk:** Low (requires API clients to provide API key). **Downtime:** None.
4. **Harden Body Parser & DoS Vectors:**
   - Reduce JSON body limit from `10mb` to `256kb`.
   - Remove `console.dir(req.body, { depth: null })` from all callback endpoints.
   - **Files:** `app.js`, `controllers/beckn.controller.js`
   - **Risk:** Low. **Downtime:** None.

### PHASE 2 — Important Reliability & Protocol Fixes (Deploy Within 1-2 Weeks)
1. **Fix Route Path Mismatch (`bap_uri` vs Express Routes):**
   - Ensure incoming callbacks to `/beckn/on_*` correctly reach the controller (mount router at `/beckn` or adjust BAP URI).
   - **Files:** `app.js`, `controllers/beckn.controller.js`
   - **Risk:** Medium (must coordinate with reverse proxy routing). **Downtime:** Brief service reload.
2. **Implement In-Memory Key Caching:**
   - Load and parse `getPrivateKeyObject()` once at startup instead of reading from disk on every search.
   - **Files:** `services/becknAuth.js`
   - **Risk:** Low. **Downtime:** None.
3. **Configure Axios Timeouts & Connection Pooling:**
   - Add `timeout: 5000` and Keep-Alive agents to Axios calls in `becknClient.js`.
   - **Files:** `services/becknClient.js`
   - **Risk:** Low. **Downtime:** None.
4. **Implement Incoming Beckn Signature Verification:**
   - Build signature verification middleware for `/on_*` callbacks using Beckn Registry public keys.
   - **Files:** `services/registryLookup.js`, new middleware `middlewares/becknAuth.middleware.js`.
   - **Risk:** Medium (requires registry lookup cache). **Downtime:** None.

### PHASE 3 — Persistence & Architecture Improvements (Deploy Within 3-4 Weeks)
1. **Introduce Database / Cache Layer (Redis / PostgreSQL):**
   - Persist transactions by `transaction_id` and `message_id`.
   - Store incoming `/on_search` catalog results so the client application can query available EV chargers.
   - **Files:** New models, migrations, and database connection service.
   - **Risk:** High (new architectural component). **Downtime:** Planned maintenance.
2. **Add HTTP Security Middleware & Rate Limiting:**
   - Install and configure `helmet`, `cors`, and `express-rate-limit`.
   - **Files:** `app.js`, `package.json`
   - **Risk:** Low. **Downtime:** None.
3. **Implement Full Beckn Transaction Lifecycle:**
   - Implement outgoing handlers for `select`, `init`, and `confirm` to allow actual EV charging reservations.
   - **Files:** `controllers/beckn.controller.js`, `services/becknClient.js`
   - **Risk:** Medium. **Downtime:** None.

### PHASE 4 — Observability & Code Quality Improvements
1. **Implement Structured Logging:**
   - Replace bare console statements with `pino` structured logger in `utils/logger.js`.
2. **Graceful Shutdown & Process Traps:**
   - Add `SIGTERM` and `SIGINT` handlers in `server.js`.
3. **Clean Up Unused Dependencies:**
   - Remove unused `uuid` dependency from `package.json`.

---

## 14. PRODUCTION SAFETY & DEPLOYMENT CHECKLIST

Before deploying any future updates to the live production VPS, execute the following safety protocol:

- [ ] **1. Backup Live State:** Create an archive of the active production directory and current `.env` file before applying code changes.
- [ ] **2. Verify Key Isolation:** Confirm that `keys/` is listed in `.gitignore` and that file permissions on the production key are restricted (`chmod 600 keys/beckn_private_key.pem`).
- [ ] **3. Environment Consistency:** Verify that `.env` on production sets `NODE_ENV=production` and points to the live Beckn Gateway URL rather than `127.0.0.1`.
- [ ] **4. Reverse Proxy Path Verification:** Validate that Nginx/Caddy forwards both `/search` and `/beckn/on_*` correctly to internal port `3002`.
- [ ] **5. Zero-Downtime Reload:** When using PM2, execute `pm2 reload ecosystem.config.js` rather than `pm2 restart` to prevent dropping in-flight Beckn transactions.
- [ ] **6. Post-Deployment Health Check:** Issue a test `curl -i http://localhost:3002/health` to confirm the Express listener is healthy.
- [ ] **7. Smoke Test Outbound Search:** Execute an authenticated test search and inspect logs to confirm successful key parsing and signature generation without CPU latency spikes.
