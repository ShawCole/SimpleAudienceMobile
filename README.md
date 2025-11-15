# 📱 SimpleAudience Mobile

> **Mobile-first web application for creating, managing, and automating SimpleAudience audiences**

A complete solution for building and managing SimpleAudience audiences through an intuitive mobile interface backed by a powerful headless automation engine.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

---

## ✨ Features

### 🎯 Audience Creation & Management
- **Multi-step wizard** for intuitive audience creation
- **Real-time filtering** with location, intent, and custom criteria
- **AI-powered intent generation** for smart keyword suggestions
- **Live preview** of audience size before generation
- **Status monitoring** with automatic updates

### 🔄 Automation Engine
- **Headless browser automation** using Puppeteer
- **Smart XPath selectors** for reliable DOM interaction
- **State machine** for deterministic workflow management
- **Retry logic** with exponential backoff
- **Error recovery** and detailed logging

### 📊 Dashboard & Monitoring
- **Mobile-optimized dashboard** showing all audiences
- **Real-time status updates** (via SWR polling)
- **Filter-based audience details**
- **Refresh scheduling** (manual, daily, weekly, monthly)
- **Duplicate & delete** operations with confirmation

### 🚀 Mobile-First Design
- **Responsive layout** for iOS, Android, and desktop
- **Touch-friendly UI** (44px minimum touch targets)
- **Dark mode support**
- **Progressive Web App** ready
- **Offline-capable** (with service workers)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile Web Interface                      │
│                    (Next.js + React)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Dashboard │  │ Create   │  │ Audience │  │ Settings │   │
│  │          │  │ Wizard   │  │ Detail   │  │          │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/REST
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     REST API Server                          │
│                   (Express + TypeScript)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Audiences │  │ Webhooks │  │  Google  │  │  Auth    │   │
│  │  CRUD    │  │ Manager  │  │  Drive   │  │ Service  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Headless Automation Engine                      │
│                  (Puppeteer + State Machine)                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Browser  │  │  XPath   │  │  State   │  │  Retry   │   │
│  │ Manager  │  │ Helpers  │  │ Machine  │  │  Logic   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  SimpleAudience Web App                      │
│              (Automated via Puppeteer)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** or **yarn**
- **SimpleAudience account** with credentials

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd SimpleAudienceMobile

# Install dependencies
npm install

# Set up environment variables
cp backend/.env.example backend/.env
cp mobile/.env.local.example mobile/.env.local

# Edit backend/.env with your SimpleAudience credentials
# SIMPLEAUDIENCE_EMAIL=your-email@example.com
# SIMPLEAUDIENCE_PASSWORD=your-password

# Start development servers
npm run dev
```

The application will be available at:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001

### First Run

1. Open http://localhost:3000
2. Click **"Create Audience"**
3. Follow the wizard:
   - Enter audience name
   - Add location filters (optional)
   - Set intent targeting (optional)
   - Review and create
4. Monitor audience status on the dashboard

---

## 📂 Project Structure

```
SimpleAudienceMobile/
├── backend/                    # Node.js automation engine
│   ├── src/
│   │   ├── automation/        # Browser automation & state machine
│   │   │   ├── browser-manager.ts
│   │   │   ├── state-machine.ts
│   │   │   └── simpleaudience-client.ts
│   │   ├── api/               # REST API routes
│   │   │   └── routes.ts
│   │   ├── services/          # Business logic
│   │   │   ├── database.ts
│   │   │   ├── audience-service.ts
│   │   │   └── google-drive-service.ts
│   │   ├── utils/             # Utilities
│   │   │   ├── logger.ts
│   │   │   ├── xpath.ts
│   │   │   ├── retry.ts
│   │   │   └── selectors.ts
│   │   └── index.ts           # Server entry point
│   ├── data/                  # SQLite database
│   └── logs/                  # Application logs
│
├── mobile/                     # Next.js mobile UI
│   └── src/
│       ├── app/               # Next.js app router
│       │   ├── page.tsx       # Dashboard
│       │   ├── create/        # Audience creation wizard
│       │   └── audience/[id]/ # Audience detail page
│       ├── components/        # React components
│       │   ├── layout/        # Header, navigation
│       │   ├── ui/            # Button, Card, Input, etc.
│       │   └── audience/      # Audience-specific components
│       ├── hooks/             # Custom hooks (SWR)
│       ├── services/          # API client
│       └── styles/            # Global styles
│
├── shared/                     # Shared TypeScript types
│   ├── types/                 # Common interfaces
│   │   ├── audience.ts
│   │   ├── api.ts
│   │   └── automation.ts
│   └── utils/                 # Shared utilities
│       ├── validators.ts
│       └── formatters.ts
│
├── docs/                       # Documentation
│   ├── INSTALLATION.md
│   ├── API.md
│   └── DEVELOPMENT.md
│
├── CLAUDE.md                   # AI assistant context
├── README.md                   # This file
└── package.json               # Workspace configuration
```

---

## 🎯 Core Workflows

### Creating an Audience

```typescript
// 1. User fills out creation wizard
const audienceData = {
  name: "Tech Startups in California",
  filters: {
    location: {
      states: ["CA"],
      cities: ["San Francisco", "Los Angeles"]
    },
    intent: {
      type: "custom",
      keywords: ["cloud computing", "SaaS"],
      score: "medium"
    }
  }
};

// 2. API request to backend
POST /api/audiences
{
  "name": "Tech Startups in California",
  "filters": { ... }
}

// 3. Backend automation flow
BrowserManager → Authenticate → Navigate to Create Audience
→ Apply Filters → Preview → Generate → Monitor Status

// 4. Status updates propagate to UI
building → previewing → generating → in_queue → processing → completed
```

### Refreshing an Audience

```typescript
// Manual refresh
POST /api/audiences/:id/refresh

// Scheduled refresh
POST /api/audiences/:id/refresh
{
  "schedule": "7_days"  // everyday, 3_days, 7_days, 14_days, monthly
}
```

---

## 🛠️ Technology Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| **Node.js + TypeScript** | Server runtime & type safety |
| **Express** | REST API framework |
| **Puppeteer** | Headless browser automation |
| **better-sqlite3** | Embedded database |
| **Winston** | Logging |
| **Zod** | Schema validation |

### Frontend
| Technology | Purpose |
|-----------|---------|
| **Next.js 14** | React framework with App Router |
| **TypeScript** | Type safety |
| **Tailwind CSS** | Utility-first styling |
| **SWR** | Data fetching & caching |
| **Axios** | HTTP client |
| **React Hot Toast** | Notifications |
| **Lucide React** | Icons |

---

## 📖 Documentation

- **[Installation Guide](docs/INSTALLATION.md)** - Detailed setup instructions
- **[API Reference](docs/API.md)** - Complete API documentation
- **[CLAUDE.md](CLAUDE.md)** - AI assistant context & future iterations

---

## 🔧 Configuration

### Backend Environment Variables

```env
# Server
PORT=3001
NODE_ENV=development

# SimpleAudience
SIMPLEAUDIENCE_EMAIL=your-email@example.com
SIMPLEAUDIENCE_PASSWORD=your-password
SIMPLEAUDIENCE_BASE_URL=https://app.simpleaudience.io

# Database
DATABASE_PATH=./data/simpleaudience.db

# Browser Automation
HEADLESS=true
BROWSER_TIMEOUT=30000

# Google Drive (Optional)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
```

### Frontend Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

---

## 🧪 Development

### Running Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd mobile
npm test
```

### Building for Production

```bash
# Build all packages
npm run build

# Start production servers
npm start
```

### Debugging

```bash
# Enable verbose logging
LOG_LEVEL=debug npm run dev

# Disable headless mode (see browser automation)
HEADLESS=false npm run dev

# Take screenshots during automation
# See: backend/src/automation/browser-manager.ts
```

---

## 📊 Database Schema

The application uses SQLite with the following tables:

- **audiences** - Audience metadata and filters
- **downloads** - CSV download history
- **webhooks** - Webhook configurations
- **operations** - Operation history and status

See `backend/src/services/database.ts` for detailed schema.

---

## 🚨 Known Limitations

### Current Implementation

✅ **Fully Implemented:**
- Audience creation with location & intent filters
- Dashboard with real-time updates
- Refresh, duplicate, delete operations
- Mobile-responsive UI

⚠️ **Partial Implementation:**
- XPath selectors (need customization for your SimpleAudience instance)
- AI intent generation (placeholder logic)
- Status polling (simulated, needs actual DOM scraping)

❌ **Not Yet Implemented:**
- Google Drive file upload
- Webhook triggers
- Advanced filters (business, financial, personal)
- CSV download handling
- Mobile share sheet

### SimpleAudience-Specific Challenges

- **XPath Selectors:** The selectors in `backend/src/utils/selectors.ts` are placeholders. You must inspect your SimpleAudience instance and update them.
- **Rate Limiting:** No protection against automation detection
- **Dynamic Content:** Some UI elements may load slowly or change
- **Popup Handling:** Multiple popups can stack unexpectedly

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Automation powered by [Puppeteer](https://pptr.dev/)
- UI components inspired by [Tailwind UI](https://tailwindui.com/)

---

## 📞 Support

For issues, questions, or feature requests, please:

1. Check existing [issues](../../issues)
2. Review the [documentation](docs/)
3. Open a new issue with detailed information

---

**Made with ❤️ for SimpleAudience automation**
