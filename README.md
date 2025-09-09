# 🚛 BuffaLink – Vehicle Tracking Dashboard

BuffaLink is a full-stack web application. It was designed to help a logistics company monitor vehicle data in real time, including MOT dates, service schedules, and VOR (Vehicle Off Road) status.

> 🔒 **Note**: This repository showcases the codebase, but the live application is not publicly accessible due to internal company data. However, this README includes screenshots and feature overviews to give you a full picture.

---

## 🛠️ Tech Stack

- **Frontend**: React, TypeScript
- **Styling**: CSS Modules
- **Backend**: Express.js (Node.js)
- **Database**: MongoDB (via Mongoose)
- **APIs Used**:
  - Michelin Connected API (for vehicle tracking data)
  - BlueCrystal API (for maintenance/service data)
- **Auth**: Role-based login system (Admin, Depot based view)

---

## 🚘 Features

### 🔐 Login & Role-Based Access
- Secure login system with different access levels
- Admins can see all vehicles and assign them to night-outs
- Depot based role can only see vehicles assigned to that depot

### 📋 Vehicle Dashboard
- Vehicle cards display:
  - Registration info
  - MOT and Service Due Dates
  - VOR (Vehicle Off Road) Status
  - Live defects
- Colour-coded statuses for quick identification (e.g. red for overdue)

### 🧠 Night-Out Tracker (Custom Filter)
- Vehicles can be manually flagged as "Night-Out"
- Automatically removes vehicles from Night-Out view when eventType updates

### 📦 API Integration
- Matches vehicle data across two APIs using `assetName` and `vehicleId`
- Merges info like service dates, defects, and MOTs into unified vehicle cards

---

## 📸 Screenshots

### 🔐 Login Page
<img width="588" height="431" alt="login" src="https://github.com/user-attachments/assets/30c98169-b535-4664-8990-bc90cc3469fa" />

- The login screen supports role-based access (Admin, Depot Viewer). Each role sees a different part of the application depending on their permissions.
  

### 🧾 Vehicle Dashboard
<img width="1904" height="962" alt="buff - Edited" src="https://github.com/user-attachments/assets/cde5f90e-76f1-4971-be54-b7032bbcf31f" />

- Displays vehicle cards showing registration info, service and MOT due dates, and status indicators for VOR and defects. Cards are colour-coded for quick scanning.
  

### 🌙 Night-Out Page
<img width="1891" height="957" alt="night-out" src="https://github.com/user-attachments/assets/3738209f-bada-43d4-987e-780a6636172c" />

- Shows vehicles manually flagged as “Night-Out”. These are removed automatically from this view when their `eventType` changes from `stopped` to `driving`.
  

### 🛠️ Services Page (Time Tracking)
<img width="1888" height="936" alt="colour-coded" src="https://github.com/user-attachments/assets/1208dc0e-6515-40ed-a956-41ff44090bef" />

- Shows real-time tracking of vehicles in known/unknown locations. Colour-coded by time:
  - **White**: < 15 mins  
  - **Yellow**: 15–30 mins  
  - **Orange**: 30–45 mins  
  - **Red**: > 45 mins  
  Helps prioritise attention for vehicles waiting too long.

---

## 🤝 What I Worked On

This was a solo-built project, designed to solve real problems within the company's workflow.

I was responsible for:

- Building the frontend with React and TypeScript, using modular components and hooks
- Integrating and merging data from two separate APIs
- Implementing role-based access control to customise the UI based on user roles
- Creating filtered views like "Night-Out" and live service tracking with dynamic time-based colour indicators
- UI/UX improvements based on user feedback

While I worked independently, I made heavy use of documentation, online resources, and AI tools like ChatGPT to troubleshoot and learn along the way. Every decision and feature was built with a focus on practicality and scalability.
