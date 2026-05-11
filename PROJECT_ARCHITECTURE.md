# BuffaLink: Comprehensive Project Architecture Overview

## 📋 Executive Summary

**BuffaLink** is a full-stack vehicle tracking and fleet management dashboard built for Buffaload Logistics Ltd. It aggregates real-time vehicle data from multiple external APIs and provides role-based access for different user levels to monitor fleet status, maintenance schedules, and vehicle operations.

---

## 1. PROJECT PURPOSE & MAIN FEATURES

### Core Purpose
BuffaLink is designed to help logistics companies monitor vehicle data in real time, including:
- Vehicle location and movement tracking
- MOT (Ministry of Transport) compliance dates
- Service schedule management
- VOR (Vehicle Off Road) status tracking
- Live defect monitoring
- Maintenance location tracking

### Key Features

#### 🔐 **Role-Based Access Control**
- **Admin Users**: Can view all vehicles across all depots and manually assign vehicles to night-out status
- **Depot Users**: Limited view based on assigned depot location
- Secure JWT token-based authentication with 24-hour expiry

#### 📊 **Vehicle Dashboard**
- Color-coded vehicle cards for quick visual scanning
- Real-time vehicle status indicators
- Registration information display
- MOT and Service due dates
- Live defect status
- VOR (Vehicle Off Road) flag
- Location information with address

#### 🌙 **Night-Out Tracker**
- Manually flag vehicles as "Night-Out"
- Automatic removal from night-out view when vehicle begins driving (eventType changes from "stopped" to "driving")
- Persistent metadata storage

#### 📍 **Multi-Location Filtering**
- **HGVs**: Vehicles stopped for more than 1.5 hours in known locations (excludes depots, maintenance, services)
- **Services**: Vehicles in Services/Truckstops with no location name or stopped >5 minutes
- **Depots**: Vehicles at company depots (Ellington, Crewe, Skelmersdale)
- **Maintenance**: Vehicles in maintenance locations
- **Tippers**: Specialized tipper operation vehicles

#### 🕐 **Time-Based Color Coding**
- **White**: Vehicle stopped <15 minutes
- **Yellow**: Vehicle stopped 15-30 minutes
- **Orange**: Vehicle stopped 30-45 minutes
- **Red**: Vehicle stopped >45 minutes

---

## 2. BACKEND ARCHITECTURE

### Technology Stack
```
- Runtime: Node.js (v20.x)
- Framework: Express.js
- Database: MongoDB with Mongoose ODM
- Authentication: JWT (jsonwebtoken)
- Password Hashing: bcryptjs
- HTTP Client: axios
- Validation: express-validator
- CORS: cors middleware
```

### Project Structure
```
backend/
├── server.js                 # Main application entry point
├── config/
│   └── visibilityRules.js   # Depot-based access control rules
├── middleware/
│   ├── auth.js              # JWT token verification
│   └── role.js              # Role-based access control
├── models/
│   ├── User.js              # User schema (authentication)
│   └── VehicleMetadata.js   # Vehicle metadata (night-out status)
├── routes/
│   ├── auth.js              # Authentication endpoints
│   └── vehicles.js          # Vehicle data endpoints
├── package.json
└── seedData.js              # Database seeding script
```

### Core Models

#### **User Model** [models/User.js]
```javascript
{
  username: String (unique, required),
  password: String (hashed, required),
  role: String (enum: "user", "admin", default: "user"),
  depot: String (required)
}
```
- Role determines visibility rules and access permissions
- Depot field enables location-based filtering

#### **VehicleMetadata Model** [models/VehicleMetadata.js]
```javascript
{
  assetName: String (unique, required),
  isNightOut: Boolean (default: false),
  lastEventType: String (tracks previous vehicle state)
}
```
- Lightweight metadata layer for application-specific vehicle data
- Persists user-defined night-out status independently from external APIs

### Middleware Layer

#### **Authentication Middleware** [middleware/auth.js]
- Extracts JWT token from `Authorization: Bearer <token>` header
- Verifies token signature using `process.env.JWT_SECRET`
- Attaches decoded user data to `req.user` (includes: id, role, depot)
- Returns 401 Unauthorized if token missing or invalid

#### **Role Middleware** [middleware/role.js]
- Parameterized middleware factory: `checkRole(requiredRole)`
- Validates that authenticated user has required role
- Returns 403 Forbidden if role mismatch
- Used to protect admin-only endpoints

### API Routes

#### **Authentication Routes** [routes/auth.js]

**POST `/api/auth/register`**
- **Validation**: Username required, password ≥6 characters
- **Process**:
  1. Check if username already exists
  2. Hash password with bcrypt (salt: 10 rounds)
  3. Save new user to database
  4. Generate JWT token (24-hour expiry)
- **Returns**: JWT token for immediate login

**POST `/api/auth/login`**
- **Validation**: Username and password required
- **Process**:
  1. Find user by username
  2. Compare provided password against hashed password
  3. Generate JWT token on successful match
- **Returns**: Token + user metadata (username, role, depot)
- **Special**: Creates test user automatically if credentials match "testuser/testpass"

**POST `/api/auth/test-login`** (Development only)
- Creates test user if doesn't exist
- Returns immediately with valid JWT token
- Used for local testing without manual registration

#### **Vehicle Routes** [routes/vehicles.js]

**GET `/api/vehicles`** (Protected: requires auth)
- **Authentication**: Requires valid JWT token in Authorization header
- **Data Source**: Fetches from local MongoDB (currently mocked for testing)
- **Data Merge**:
  1. Retrieves vehicles from Vehicle collection
  2. Fetches maintenance data from Maintenance collection
  3. Loads night-out metadata from VehicleMetadata collection
  4. Merges all three datasets using normalized assetName as key
- **Automatic Cleanup**:
  - If vehicle eventType changes from "stopped" → "driving", automatically removes from night-out
  - Deletes corresponding VehicleMetadata document
- **Access Control**: All users see all vehicles (admin filter commented out but framework in place)
- **Returns**: Array of merged vehicle objects with all fields

**PATCH `/api/vehicles/{assetName}/night-out`** (Protected: requires auth)
- **Parameters**: 
  - `assetName` (URL): Vehicle asset name (normalized to uppercase, spaces trimmed)
  - `isNightOut` (body): Boolean flag
- **Logic**:
  - If `isNightOut: true`: Upserts document into VehicleMetadata
  - If `isNightOut: false`: Deletes document from VehicleMetadata
- **Returns**: Success/failure message

### Data Models & Schemas (Inline)

**Vehicle Collection** (embedded schema in routes/vehicles.js)
```javascript
{
  assetName: String,
  eventType: String,           // "driving" | "stopped" | "parked"
  locationName: String,        // Human-readable location
  formattedAddress: String,    // Full address
  date: String,                // Last status update timestamp
  locationGroupName: String,   // "Services and Truckstops", "Buffaload", etc.
  assetGroupName: String,      // "Ellington DVS Units", "Ely Tipper Operation"
  assetType: String            // "HGV", "Trailer", etc.
}
```

**Maintenance Collection** (embedded schema in routes/vehicles.js)
```javascript
{
  VehicleId: String,           // Normalized vehicle identifier
  ServiceDueDate: String,      // Next service date
  MotDueDate: String,          // Next MOT date
  IsVor: Boolean,              // Vehicle Off Road flag
  LiveDefects: Boolean         // Has active defects
}
```

### Server Configuration [server.js]

**CORS Configuration**
```javascript
allowedOrigins: [
  "https://buffa-link-backend.vercel.app",
  "https://buffalink.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5050"
]
```
- Allows requests from frontend (dev and production URLs)
- Supports GET, POST, PUT, PATCH, DELETE methods
- Allows Content-Type and Authorization headers

**MongoDB Connection**
- Uses `mongoose.connect(process.env.MONGO_URI)`
- Logs success/failure on startup

**Public Routes**
- `/api/test`: Simple test endpoint
- `/api/auth/*`: All authentication endpoints (no protection)

**Protected Routes**
- `/api/user`: All authenticated users
- `/api/admin`: Admin users only
- `/api/vehicles/*`: All authenticated users

---

## 3. FRONTEND ARCHITECTURE

### Technology Stack
```
- Framework: React 18.3.1 with TypeScript
- Routing: React Router DOM v6
- State Management: TanStack React Query v5 (for server state)
- HTTP Client: axios
- Data Visualization: Chart.js + react-chartjs-2
- Styling: CSS Modules (scoped CSS)
```

### Project Structure
```
client/src/
├── App.tsx                    # Main app router
├── index.tsx                  # React entry point
├── config.js                  # API configuration
├── components/
│   ├── Login.tsx             # Authentication form
│   ├── Dashboard.tsx         # Main layout/hub
│   ├── Sidebar.tsx           # Navigation and filters
│   ├── ProfileButton.tsx     # User menu
│   ├── Vehicles.tsx          # Vehicle list/cards
│   ├── VehicleGraph.tsx      # Data visualization
│   ├── ProtectedRoute.tsx    # Route protection
│   └── Register.tsx          # User registration (optional)
├── css/
│   ├── App.css
│   ├── Dashboard.css
│   ├── Login.css
│   ├── Sidebar.css
│   ├── Vehicles.css
│   └── ProfileButton.css
└── public/
    ├── index.html
    ├── manifest.json
    └── robots.txt
```

### Core Components

#### **App.tsx** (Root Component)
**Purpose**: Application router and authentication state management

**Key Features**:
- Maintains global `token` state in localStorage
- Service worker cleanup (disables offline caching)
- Route definitions with authentication guards

**Routes**:
1. `/login` → `<Login />` (public, redirects to dashboard if logged in)
2. `/dashboard` → `<Dashboard />` (protected)
3. `/vehicles` → `<Vehicles />` (protected)
4. `*` → Redirects to `/login` (default)

**Props Management**:
- `handleLogin(token)`: Stores token in state and localStorage
- `handleLogout()`: Clears token and related user data

#### **Login.tsx** (Authentication)
**Purpose**: User login interface

**Functionality**:
1. Accepts username and password
2. Posts credentials to `POST /api/auth/login`
3. Receives JWT token in response
4. Decodes JWT payload to extract expiry time (`exp` claim)
5. Stores in localStorage:
   - `token`: JWT token
   - `tokenExpiry`: Expiration timestamp (milliseconds)
   - `username`: For display
   - `role`: For permission checks
6. Redirects to `/dashboard` on success
7. Shows error message on failed authentication

**Token Format**:
- JWT structure: `header.payload.signature`
- Payload decoded using `atob()` for expiry extraction
- Expiry time converted from Unix seconds to milliseconds

#### **ProtectedRoute.tsx** (Route Guard)
**Purpose**: Prevents access to protected routes without valid token

**Functionality**:
1. Checks token existence and expiry on mount
2. Validates expiry: compares `localStorage.tokenExpiry` against current time
3. Auto-redirects to `/login` if:
   - Token missing
   - Token expired
   - Expiry timestamp invalid
4. Clears all user data from localStorage on invalid token
5. Checks token validity every 1 second (polling interval)
6. Renders protected component only if token is valid

**Implementation**: React Router's higher-order pattern with custom validation logic

#### **Dashboard.tsx** (Main Hub)
**Purpose**: Primary user interface layout and state management

**Layout**:
```
┌─────────────────────────────────┐
│      DASHBOARD HEADER            │
│  [Title] ← Dynamic by Filter     │  [Profile Button]
├──────────────┬──────────────────┤
│   SIDEBAR    │                  │
│ - Filters    │  VEHICLES LIST   │
│ - Options    │  (Main Content)  │
└──────────────┴──────────────────┘
```

**State Management**:
- `filterOption`: Currently selected filter ("HGVs", "Services", "Night-Out", "Depots", etc.)
- `selectedDepots`: Array of selected depots for filtering
- Token validation on mount

**Filter Titles** (Dynamic Header):
- HGVs → "HGVs stopped for more than 1.5 hours in known locations"
- Services → "Vehicles stopped in Services and Truckstops as well as Unknown locations"
- Night-Out → "Vehicles flagged as Night-Out"
- Depots → "Vehicles located in Depots"
- Maintenance → "Vehicles in Maintenance locations"
- Tippers → "Vehicles from the TFP Tipper Operation"

**Child Props Passed**:
- `<Sidebar />`: Receives `onFilterChange`, `onDepotChange`, `filterOption`
- `<Vehicles />`: Receives `filterOption`, `selectedDepots`
- `<ProfileButton />`: Receives `username`, `handleLogout`

#### **Sidebar.tsx** (Navigation & Filters)
**Purpose**: Filter selection and depot management

**Features**:
1. **Responsive Hamburger Menu**: Toggles sidebar on mobile
2. **Main Filters** (buttons):
   - HGVs
   - Services (expandable)
   - Depots (expandable)
   - Maintenance
   - Tippers

3. **Sub-tabs** (conditional rendering):
   - Services → includes "Night-Out" option
   - Depots → includes depot checkboxes (Ellington, Crewe, Skelmersdale)

4. **State Management**:
   - `activeButton`: Tracks selected filter
   - `selectedDepots`: Array of checked depots
   - `userRole`: Fetched from localStorage

5. **Event Handlers**:
   - `handleButtonClick()`: Main filter selection
   - `handleSubTabClick()`: Sub-filter selection
   - `handleDepotClick()`: Toggle individual depot selection

#### **Vehicles.tsx** (Vehicle List Display)
**Purpose**: Fetch, filter, display, and interact with vehicle data

**Data Fetching** (using TanStack React Query):
```javascript
useQuery({
  queryKey: ["vehicles"],
  queryFn: fetchVehicles,
  refetchInterval: 30000,  // Auto-refresh every 30 seconds
  staleTime: 60000         // Data considered fresh for 1 minute
})
```
- Fetches from `GET /api/vehicles` with Bearer token
- Automatically retries on failure
- Provides loading and error states

**TypeScript Interfaces**:
```typescript
interface Vehicle {
  id?: string;
  assetName: string;
  assetRegistration?: string;
  locationName?: string;
  formattedAddress?: string;
  eventType: string;        // "driving" | "stopped"
  date: string;             // Last update timestamp
  locationGroupName?: string;
  assetGroupName?: string;
  assetType?: string;       // "HGV" | "Trailer"
  ServiceDueDate?: string;
  MotDueDate?: string;
  IsVor?: boolean;
  LiveDefects?: boolean;
  isNightOut?: boolean;
}
```

**Complex Filtering Logic** (useMemo optimization):
Filters applied based on `filterOption`:

1. **Night-Out**: `vehicle.isNightOut === true`

2. **HGVs**:
   - Asset type = "HGV"
   - Known location (not null)
   - Stopped >90 minutes (1.5 hours)
   - Excludes: Buffaload depots, Maintenance, Services, Tippers

3. **Services**:
   - Asset type = "HGV"
   - Location: Services/Truckstops OR no location
   - Stopped >5 minutes
   - Not driving
   - Excludes: Depots, Maintenance, Tippers, Night-Out

4. **Depots**:
   - Location group = "Buffaload"
   - Specific location based on depot selection
   - Excludes: Tippers
   - Optional VOR filter (shows only VOR or defective vehicles)

5. **Maintenance**:
   - Location group = "Maintenance"

6. **Tippers**:
   - Asset group = "TFP Tipper Operation"

**Time-Based Calculations**:
- `getTimeSinceUpdate()`: Humanized relative time ("3 hours 45 minutes ago")
- `calculateTimeStopped()`: Milliseconds since last status change
- BST offset handling for naive timestamps

**Color Coding** (background by stop duration):
- Red (≥45 min): `pastel-red`
- Orange (30-45 min): `pastel-orange`
- Yellow (15-30 min): `pastel-yellow`
- Default: No color

**Tipper Alert Animation**:
- Mode: "breathe" (fade in/out effect)
- Critical alert: Red + faster breathing if stopped ≥45 min
- Yellow warning: 15-45 min stopped
- No alert if VOR status active

**Night-Out Toggle** (Optimistic Updates):
```javascript
toggleNightOut(vehicle)
├── Immediately update UI (optimistic)
├── Send PATCH request
├── Revert on failure
└── Refetch on success (TanStack Query)
```

**UI Elements Per Card**:
- Vehicle registration number
- Asset name
- Current location and address
- Time stopped (with color coding)
- MOT due date (with overdue indicator)
- Service due date (with overdue indicator)
- VOR status badge
- Defects indicator
- Night-Out toggle button

#### **ProfileButton.tsx** (User Menu)
**Purpose**: Display user info and logout option

**Features**:
- Shows current username
- Logout button
- Calls `handleLogout()` from parent

#### **VehicleGraph.tsx** (Data Visualization)
**Purpose**: Chart/graph display of vehicle metrics

- Uses Chart.js for rendering
- react-chartjs-2 for React integration
- Not heavily featured in current implementation

#### **Register.tsx** (User Registration)
**Purpose**: New user account creation (optional feature)

### API Configuration [config.js]
```javascript
const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:5050/api"        // Local development
    : "https://buffa-link-backend.vercel.app/api" // Production
```
- Automatically selects correct API endpoint based on hostname
- Enables seamless dev-to-prod deployment

### State Management Pattern

**Local State** (useState):
- Component-level UI state (filters, active buttons, modals)

**Global State** (localStorage):
- `token`: JWT authentication token
- `tokenExpiry`: Token expiration timestamp
- `username`: Current logged-in user
- `role`: User role for permission checks

**Server State** (TanStack React Query):
- Vehicle data with automatic caching
- 30-second polling interval for real-time updates
- Automatic retry on network failures
- Optimistic updates for night-out toggles

---

## 4. DATA FLOW ARCHITECTURE

### Complete Request/Response Cycle

#### **Login Flow**
```
User Input (credentials)
    ↓
[Login.tsx] POST /api/auth/login
    ↓
[Backend auth.js]
  ├─ Find user by username
  ├─ Compare bcrypt passwords
  ├─ Sign JWT token
    ↓
[Response] {token, username, role, depot}
    ↓
[Login.tsx] Decode JWT, extract expiry
    ↓
localStorage.setItem() [token, tokenExpiry, username, role]
    ↓
window.location.href = "/dashboard"
    ↓
[App.tsx] Token state updated
    ↓
[ProtectedRoute.tsx] Validates token expiry
    ↓
[Dashboard.tsx] Renders with user context
```

#### **Vehicle Data Fetch Flow**
```
[Dashboard.tsx] Mount
    ↓
[Sidebar.tsx] User selects filter
    ↓
setFilterOption(filterOption)
    ↓
[Vehicles.tsx] useQuery hook triggered
    ↓
[Backend GET /api/vehicles]
  ├─ Middleware: auth (verify JWT)
  ├─ Query: Vehicle.find({})
  ├─ Query: Maintenance.find({})
  ├─ Query: VehicleMetadata.find({})
  ├─ Merge: Combine by normalized assetName
  ├─ Auto-cleanup: Remove night-out if driving
    ↓
[Response] Array of merged vehicle objects
    ↓
[TanStack React Query] Cache data
    ↓
[Vehicles.tsx] useMemo filter computation
  ├─ Apply selected filter logic
  ├─ Calculate time-based colors
  ├─ Render filtered vehicles
    ↓
[UI] Display vehicle cards with metadata
```

#### **Night-Out Toggle Flow**
```
User clicks toggle button
    ↓
[Vehicles.tsx] toggleNightOut(vehicle)
  ├─ Save previous state
  ├─ Calculate new state (!isNightOut)
  ├─ Optimistic update: queryClient.setQueryData()
    ↓
[UI] Vehicle card updates immediately
    ↓
[Backend PATCH /vehicles/{assetName}/night-out]
  ├─ Normalize assetName (uppercase, trim)
  ├─ If isNightOut true: upsert VehicleMetadata
  ├─ If isNightOut false: delete VehicleMetadata
    ↓
[Response] Success/failure message
    ↓
If success: Refetch vehicle list
If failure: Revert optimistic update
    ↓
[UI] Shows updated state or error
```

#### **Auto-Logout Flow**
```
[ProtectedRoute.tsx] Every 1000ms
    ↓
Check: localStorage.tokenExpiry < currentTime?
    ↓
If expired:
  ├─ Clear all localStorage data
  ├─ navigate("/login")
  ├─ Component unmounts
    ↓
[Login.tsx] Renders
```

### Data Transformation Pipeline

**Raw API Data** → **Backend Processing** → **Frontend Filtering** → **UI Rendering**

```
Vehicle Record:
{
  assetName: "ML19OEC",
  eventType: "stopped",
  date: "2024-04-15T14:30:00Z"
}

Maintenance Record:
{
  VehicleId: "ML19OEC",
  ServiceDueDate: "2024-05-01",
  MotDueDate: "2024-06-15",
  IsVor: false,
  LiveDefects: true
}

Night-Out Metadata:
{
  assetName: "ML19OEC",
  isNightOut: true
}

                    ↓ [Backend Merge]

Merged Vehicle:
{
  assetName: "ML19OEC",
  eventType: "stopped",
  date: "2024-04-15T14:30:00Z",
  ServiceDueDate: "2024-05-01",
  MotDueDate: "2024-06-15",
  IsVor: false,
  LiveDefects: true,
  isNightOut: true
}

                    ↓ [Frontend Filter]

Filtered (if filter="Night-Out"):
- Shows vehicle because isNightOut=true

                    ↓ [Frontend Enhancement]

Enhanced for Display:
{
  ...mergedVehicle,
  timeStopped: 123456000,          // ms since last update
  timeSinceUpdateText: "34 hours 26 minutes ago",
  backgroundColor: "pastel-red",   // Based on timeStopped
  isMotOverdue: true,
  isServiceOverdue: true,
  alertClass: "alert-critical"
}

                    ↓ [React Render]

<div className="vehicle-card pastel-red">
  <h3>ML19OEC</h3>
  <p>Stopped 34 hours 26 minutes ago</p>
  <span className="badge alert-critical">MOT Overdue</span>
  <button onClick={toggleNightOut}>Remove Night-Out</button>
</div>
```

---

## 5. KEY TECHNOLOGIES & FRAMEWORKS

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20.x | Runtime environment |
| Express.js | 4.21.0 | Web framework & HTTP server |
| MongoDB | 6.9.0 | NoSQL database driver |
| Mongoose | 8.6.2 | MongoDB ORM & schema validation |
| jsonwebtoken | 9.0.2 | JWT creation & verification |
| bcryptjs | 2.4.3 | Password hashing & comparison |
| axios | 1.7.7 | HTTP client (outbound API calls) |
| express-validator | 7.2.0 | Input validation middleware |
| cors | 2.8.5 | Cross-origin request handling |
| dotenv | 16.4.5 | Environment variable loading |

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 18.3.1 | UI framework |
| TypeScript | 4.9.5 | Type safety & IntelliSense |
| React Router DOM | 6.26.2 | Client-side routing |
| TanStack React Query | 5.59.0 | Server state management |
| axios | 1.7.7 | HTTP client (API calls) |
| Chart.js | 4.4.4 | Data visualization library |
| react-chartjs-2 | 5.2.0 | React wrapper for Chart.js |
| CSS Modules | (native) | Component-scoped styling |

### Infrastructure & Deployment
- **Frontend**: Vercel (buffalink.vercel.app)
- **Backend**: Vercel (buffa-link-backend.vercel.app)
- **Database**: MongoDB (cloud-hosted, URI via env var)
- **Code Version Control**: Git (implied by structure)

---

## 6. AUTHENTICATION & AUTHORIZATION APPROACH

### JWT-Based Authentication

#### **Token Structure**
```
JWT Format: Header.Payload.Signature

Example Payload (decoded):
{
  "user": {
    "id": "user_mongo_id",
    "role": "admin",           // "admin" or "user"
    "depot": "ellington"       // Specific depot location
  },
  "iat": 1713200400,          // Issued at (Unix seconds)
  "exp": 1713286800          // Expires in 24 hours
}
```

#### **Token Lifecycle**

1. **Generation** (auth/register or auth/login):
   - Created with `jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "24h" })`
   - Secret stored in environment variable (must be secure)
   - Expiry set to 24 hours

2. **Storage** (Client-side, localStorage):
   ```javascript
   localStorage.setItem("token", jwtToken);
   localStorage.setItem("tokenExpiry", expiryTimestampMs);
   ```

3. **Transmission** (Every protected request):
   ```
   Authorization: Bearer <token>
   ```
   - Token extracted from header
   - Format: `Bearer {token}` (space-separated)

4. **Verification** (Backend middleware):
   ```javascript
   jwt.verify(token, process.env.JWT_SECRET)
   // Returns: decoded payload or throws error
   ```

5. **Expiry Check** (Frontend):
   - Polling interval: 1 second (ProtectedRoute.tsx)
   - Auto-logout when `currentTime > tokenExpiry`

#### **Authentication Middleware Flow**

```
[Incoming Request with Authorization header]
    ↓
[auth.js middleware]
  ├─ Extract header: "Authorization: Bearer xyz..."
  ├─ Split by space, get token
  ├─ Call jwt.verify(token, JWT_SECRET)
    ├─ If valid: Extract user data → attach to req.user
    ├─ If invalid: Return 401 Unauthorized
    ├─ If missing: Return 401 No token
    ↓
[req.user populated with: {id, role, depot}]
    ↓
[Proceed to next middleware/route handler]
```

### Role-Based Access Control (RBAC)

#### **Role Types**
1. **"admin"**: 
   - Can view all vehicles across all locations
   - Can manually manage night-out status
   - Can access admin-specific endpoints

2. **"user"**: 
   - Standard access level
   - Currently sees same data as admin (filter rules not enforced)
   - Can toggle night-out for assigned vehicles

#### **Role-Based Middleware**

```javascript
const checkRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== requiredRole) {
      return res.status(403).json({ msg: "Access denied" });
    }
    next();
  };
};
```

**Usage** (Backend):
```javascript
// Only admin can access
app.get("/api/admin", auth, checkRole("admin"), (req, res) => { ... })

// All authenticated users can access
app.get("/api/user", auth, (req, res) => { ... })
```

#### **Depot-Based Filtering** (Not Currently Enforced)

In [backend/config/visibilityRules.js]:
```javascript
export const depotVisibilityRules = {
  ellington: [
    "Ellington DVS Units",
    "Ellington Non-DVS",
    "42 Pallet Deckers",
    ...
  ],
  crewe: [
    "CRSK DVS Units",
    "CRSK Non-DVS",
    ...
  ]
};
```

**Intended Logic** (Currently Commented Out):
```javascript
const filteredVehicles = 
  user.role === "admin"
    ? mergedVehicles  // Admins see all
    : mergedVehicles.filter(vehicle =>
        depotVisibilityRules[user.depot]?.includes(vehicle.assetGroupName)
      );  // Regular users see only depot-assigned vehicles
```

### Security Measures

#### **Password Security**
- Hashed with bcryptjs (salt rounds: 10)
- Never stored in plain text
- Compared using `bcrypt.compare()` (timing-safe)

#### **Token Security**
- Signed with `process.env.JWT_SECRET` (environment variable)
- Must never be hardcoded
- 24-hour expiry (short-lived tokens)
- Stored in `localStorage` (accessible via JavaScript)
- **Note**: localStorage not ideal for highly sensitive data; consider secure HTTP-only cookies for production

#### **CORS Protection**
- Whitelist specific origins (not wildcard)
- Explicitly allowed methods: GET, POST, PUT, PATCH, DELETE
- Explicitly allowed headers: Content-Type, Authorization

#### **Input Validation**
- express-validator on registration and login
- Username not empty
- Password minimum 6 characters
- Server-side validation (not relying on client-side only)

### Access Control Flow

```
[Unauthenticated User]
    ↓
[Attempts GET /api/vehicles]
    ↓
[auth middleware]
    └─→ No token → 401 Unauthorized
            ↓
        [User redirected to /login]

[Authenticated User with "user" role]
    ↓
[Attempts GET /api/admin]
    ↓
[auth middleware] ✓ Token valid
    ↓
[checkRole("admin") middleware]
    └─→ User role ≠ "admin" → 403 Forbidden
            ↓
        [Error message returned]

[Authenticated Admin User]
    ↓
[Attempts GET /api/admin]
    ↓
[auth middleware] ✓ Token valid
    ↓
[checkRole("admin") middleware] ✓ Role matches
    ↓
[Route handler executes]
    ↓
[Response returned]
```

---

## 7. DEVELOPMENT & DEPLOYMENT

### Environment Variables Required

**Backend** (.env):
```
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/buffalink
JWT_SECRET=your-secret-key-here
PORT=5050
NODE_ENV=development
```

**Frontend** (config.js handles automatic selection):
- No env variables needed; uses hostname detection

### Running Locally

**Backend**:
```bash
cd backend
npm install
npm start          # Starts on http://localhost:5050
```

**Frontend**:
```bash
cd client
npm install
npm start          # Starts on http://localhost:3000
```

### Build & Deployment

**Frontend Build**:
```bash
cd client
npm run build      # Creates optimized build in /build directory
# Deploy /build to Vercel or hosting platform
```

**Backend Deployment**:
- Deploy to Vercel with `vercel.json` configuration
- Environment variables set in Vercel dashboard

---

## 8. DATA PERSISTENCE & EXTERNAL API INTEGRATION

### Current Implementation
- **Local Database**: Uses MongoDB for all data storage
- **Embedded Schemas**: Vehicle and Maintenance models defined inline in routes/vehicles.js
- **Test Data**: seedData.js for populating database

### Intended Integration (Framework In Place)
- **Michelin Connected API**: Provides real-time vehicle tracking data
- **BlueCrystal API**: Provides maintenance schedule and service data
- Current implementation uses local database; API calls would replace hardcoded queries

### Data Aggregation Pattern
```
Michelin API (vehicle locations)
    ↓
BlueCrystal API (maintenance data)
    ↓
[Backend] Merge by normalized assetName
    ↓
Local VehicleMetadata (custom app state)
    ↓
[Unified Vehicle Object] Sent to frontend
```

---

## 9. KEY INSIGHTS & ARCHITECTURE PATTERNS

### Strengths
1. **Clear Separation of Concerns**: Frontend and backend cleanly separated
2. **Type Safety**: TypeScript on frontend reduces bugs
3. **Efficient Caching**: React Query handles server state with 30-second polling
4. **Modular Components**: Reusable UI components with clear props
5. **Scalable Auth**: JWT + roles provide foundation for enterprise RBAC
6. **Real-Time Capable**: Auto-refresh mechanism enables live updates

### Design Decisions
1. **localStorage for Auth**: Simple but not ideal; consider HTTP-only cookies
2. **1-Second Token Polling**: Ensures quick logout; could be optimized with event listeners
3. **Optimistic Updates**: Night-out toggle updates UI immediately (better UX)
4. **Normalized Asset Names**: Case-insensitive matching handles data inconsistencies
5. **Inline Schemas**: Temporary solution; should be extracted to separate model files

### Future Improvements
1. Enforce depot-based filtering in backend
2. Implement HTTP-only secure cookies for token storage
3. Add WebSocket for real-time updates (instead of polling)
4. Extract inline schemas to proper model files
5. Add comprehensive error boundary components
6. Implement request/response logging middleware
7. Add unit and integration tests
8. Implement API call retry logic with exponential backoff
9. Add loading skeleton states for better UX
10. Implement data export/reporting features

---

## 10. FILE DEPENDENCY MAP

```
Frontend Entry Point:
client/src/index.tsx → client/src/App.tsx

App.tsx depends on:
├── components/Login.tsx
├── components/Dashboard.tsx
├── components/ProtectedRoute.tsx
└── components/Vehicles.tsx

Dashboard.tsx depends on:
├── components/Sidebar.tsx
├── components/ProfileButton.tsx
└── components/Vehicles.tsx

Vehicles.tsx depends on:
├── config.js (API_BASE_URL)
└── @tanstack/react-query (useQuery)

---

Backend Entry Point:
backend/server.js

server.js depends on:
├── middleware/auth.js
├── middleware/role.js
├── routes/auth.js
├── routes/vehicles.js
└── config/visibilityRules.js

routes/auth.js depends on:
├── models/User.js
├── bcryptjs
└── jsonwebtoken

routes/vehicles.js depends on:
├── models/VehicleMetadata.js
├── config/visibilityRules.js
└── axios (potential external API calls)
```

---

**Document Version**: 1.0  
**Last Updated**: April 22, 2026  
**Project Status**: Production (Vercel deployment)
