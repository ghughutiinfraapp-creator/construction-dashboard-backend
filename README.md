# 🏗️ Construction Management Platform

Complete construction management solution with **Mobile App** (React Native) + **Admin Dashboard** (Next.js) + **Backend API** (Node.js + PostgreSQL).

## 🏛️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Mobile App    │     │   Dashboard     │     │   Backend API    │
│  React Native   │────▶│   Next.js +     │────▶│  Node.js +       │
│  (Engineer,     │     │   React +       │     │  Express +       │
│   Client,       │     │   Tailwind      │     │  PostgreSQL      │
│   Delivery)     │     │                 │     │  (Prisma ORM)    │
└─────────────────┘     └─────────────────┘     └──────────────────┘
                                                       │
                              Socket.io ◄──────────────┘
                           (Real-time updates)
```

## 📱 Interfaces

| Interface | Users | Key Features |
|-----------|-------|-------------|
| **Mobile App** | Site Engineer | Geo-fenced punch in/out, task management, labour attendance, PO creation, photo uploads |
| **Mobile App** | Client | Project progress, photo gallery, reports |
| **Mobile App** | Delivery Person | Pickup list, delivery photo upload |
| **Dashboard** | Super Admin | Full system control, reports, analytics |
| **Dashboard** | Project Manager | Project oversight, task assignment, team management |
| **Dashboard** | Finance Team | PO approval, vendor selection, budget tracking |

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- React Native CLI (for mobile)

### 1. Backend Setup

```bash
cd backend
cp .env.example .env          # Edit with your DB credentials
npm install
npx prisma migrate dev        # Create database tables
npx prisma generate           # Generate Prisma client
npm run db:seed               # Seed demo data
npm run dev                   # Start on port 5000
```

### 2. Dashboard Setup

```bash
cd dashboard
npm install
# Create .env.local with: NEXT_PUBLIC_API_URL=http://localhost:5000/api
npm run dev                   # Start on port 3000
```

### 3. Mobile App Setup

```bash
cd mobile
npm install
# For Android:
npx react-native run-android
# For iOS:
cd ios && pod install && cd ..
npx react-native run-ios
```

## 🔐 Demo Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@construction.com | password123 |
| Project Manager | pm@construction.com | password123 |
| Site Engineer | engineer1@construction.com | password123 |
| Finance Team | finance@construction.com | password123 |
| Delivery Person | delivery@construction.com | password123 |
| Client | client@construction.com | password123 |

## 📡 API Endpoints

### Auth
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register (Admin only)
- `POST /api/auth/refresh` - Refresh token
- `GET /api/auth/me` - Get current user

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `PUT /api/projects/:id/geofence` - Set geo-fence

### Attendance (Geo-fenced)
- `POST /api/attendance/punch-in` - Punch in with GPS + selfie
- `POST /api/attendance/punch-out` - Punch out
- `GET /api/attendance/status` - Check today's status
- `GET /api/attendance/today` - Today's records
- `GET /api/attendance/history` - Historical records

### Tasks
- `GET /api/tasks` - List tasks
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id/status` - Update status

### Labour
- `GET /api/labour/labourers` - List labourers
- `POST /api/labour/labourers` - Add labourer
- `POST /api/labour/attendance/mark` - Mark bulk attendance
- `GET /api/labour/wage-report` - Wage calculation report

### Purchase Orders (8-Stage Lifecycle)
- `POST /api/purchase-orders` - Create PO (Engineer)
- `PUT /api/purchase-orders/:id/approve` - Approve (Finance)
- `PUT /api/purchase-orders/:id/reject` - Reject (Finance)
- `PUT /api/purchase-orders/:id/assign-vendor` - Assign vendor (Finance)
- `PUT /api/purchase-orders/:id/assign-delivery` - Assign delivery

### Deliveries
- `PUT /api/deliveries/:id/picked-up` - Mark picked up
- `PUT /api/deliveries/:id/delivered` - Mark delivered + photo
- `PUT /api/deliveries/:id/verify` - Engineer verifies/raises issue

### Dashboard Analytics
- `GET /api/dashboard/stats` - KPI cards
- `GET /api/dashboard/attendance-chart` - Attendance graph
- `GET /api/dashboard/po-pipeline` - PO funnel
- `GET /api/dashboard/recent-activity` - Activity feed

## 🗄️ Database Schema (14 Tables)

users, projects, attendance, tasks, labourers, labour_attendance,
vendors, purchase_orders, po_items, material_catalog, deliveries,
photos, notifications, refresh_tokens

## 🔄 PO Workflow

```
Engineer Creates PO → Finance Reviews → Approves/Rejects
→ Finance Selects Vendor → Assigns Delivery Person
→ Delivery Picks Up → Delivers & Uploads Photo
→ Engineer Verifies & Closes PO → Admin Gets Report
```

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile App | React Native |
| Dashboard | Next.js + React + Tailwind CSS + Recharts |
| Backend | Node.js + Express |
| Database | PostgreSQL + Prisma ORM |
| Real-time | Socket.io |
| Auth | JWT + Refresh Tokens |
| File Storage | Local (upgradeable to S3) |
| Notifications | Socket.io + Firebase FCM (configurable) |
| Geo-fencing | geolib + Google Maps |
