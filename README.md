SimpleAudience Mobile Builder
A mobile-first interface for building, managing, and automating SimpleAudience lists

SimpleAudience Mobile Builder is a mobile application and headless automation layer that allows users to easily create, modify, track, and download audiences from SimpleAudience.io using a clean, intuitive mobile UI.

This project mirrors all core audience-building functionality of the SimpleAudience web platform — including filters, intent selection, previewing, generating, refreshing, duplicating, and downloading — through a fully managed automation engine running behind the scenes.

🚀 Features
Audience Creation (Mobile UI → Headless Automation)

Select filters across all categories:

Business

Financial

Personal

Family

Housing

Contact

Multi-select Cities, States, Zip Codes, with automatic validation:

Proper comma-separated insertion

Load-indicator detection

Auto-submit with Enter/Return once ready

Full Intent Engine:

Premade B2B/B2C keyword selection

Manual keyword entry

AI-generated keyword suggestions

Intent score selection (Low, Medium, High)

Filter validation before saving

Auto-sync to SimpleAudience

Audience Preview & Generation

Real-time audience preview call

Automatic extraction of preview size

Generate Audience flow:

Detects the “Generate Audience” button

Confirms popup actions

Monitors generation pipeline (“In Queue” → “Processing” → “Hydrating” → “Completed”)

Audience Status Tracking

Each created audience automatically appears in the mobile dashboard, showing:

Status

Audience size

Creation date

Last refreshed

Refresh count

Audience Management Tools

For every audience, users can:

Refresh (manual or scheduled)

Edit (reopen filter UI with prior settings)

Download CSVs (with history timestamps & row counts)

Duplicate audience

Delete audience

Add Webhook

For push notifications when audiences finish generating

Test webhook connectivity directly from the app

Webhooks & Notifications

Receive mobile notifications when:

Audience generation completes

A new downloadable CSV is available

A scheduled refresh finishes

🧠 System Architecture
1. Mobile Client (iOS / Android)

Built with:

React Native or Flutter

Optimized for:

One-handed navigation

Simple, structured filtering menus

Fast audience creation

2. Headless Automation Engine

Responsible for:

Authenticating to SimpleAudience

Applying filters based on selections

Handling UI-driven operations through automation (headless browser or API-like layer)

Monitoring audience generation lifecycle

Extracting dynamic fields (# of results, status, CSV download links)

Triggering webhook notifications

Managing CRUD operations for audiences

3. API Gateway

Mobile client communicates with the automation layer through a secure REST API

Endpoints:

/audiences/create

/audiences/:id/status

/audiences/:id/refresh

/audiences/:id/downloads

/audiences/:id/duplicate

/audiences/:id/delete

/webhook/register

/intent/generate

4. Database Layer

Stores:

User sessions

Audience metadata

Webhook URLs

Activity logs

Pending refresh schedules

5. Notification System

Push notifications handled through:

Firebase (Android)

APNs (iOS)

Triggered by:

Audience completed

CSV available

Refresh completed

Webhook events

📦 Installation
Prerequisites

Node.js 18+

Yarn or npm

Docker (for automation engine)

SimpleAudience account credentials

API keys for Firebase/APNs

Setup
git clone https://github.com/<your-org>/simpleaudience-mobile-builder
cd simpleaudience-mobile-builder

# Install mobile dependencies
cd mobile
yarn install

# Install automation layer dependencies
cd ../backend
npm install

# Setup environment variables
cp .env.example .env

Run Development Environment
Backend (Headless Automation Engine)
cd backend
npm run dev

Mobile App
cd mobile
npx expo start

📘 Usage Overview
1. Create a New Audience

Tap Create Audience

Select:

Business filters

Personal/Financial filters

Contact type (personal email, work email, etc.)

Intent (optional)

Tap Preview

Wait for result count

Tap Generate Audience

Confirm in popup

2. Monitor Audience Status

View:

Status

Size

Dates

Refresh count

Updates in real time.

3. Download Audience

Tap Downloads

Select any CSV timestamp

File is delivered to device

4. Edit / Duplicate / Refresh

Accessible via Audience Options.

5. Webhook Notifications

Register a webhook to receive:

Audience Completed events

CSV Ready events

🛠️ Development Notes
Filter Mapping

Each mobile UI selection maps to a known XPath or abstraction in the headless engine:

Filters

Dropdown options

Input validation logic

Popup handling

Loading indicator detection

Enter key confirmations (Cities, States, Zips)

Refresh Modal Handling

Dropdown options include:

Everyday

3 Days

7 Days

14 Days

1st of Every Month (UTC)

Download Modal Parsing

Each downloadable entry includes:

Timestamp

Row count

Download endpoint

Error Handling

Failed audiences

Timeouts

Missing filter selections

Invalid location inputs

Webhook failures

📄 License

MIT License — free for commercial and private use.

🤝 Contributing

Pull requests are welcome!
Please open an issue before submitting large changes.

If you'd like, I can also generate:

✅ A diagram of the system architecture
✅ A full API specification
✅ A mobile UI wireframe
✅ A database schema
✅ A naming structure for endpoints and events