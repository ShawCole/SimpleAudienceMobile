# Installation Guide

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18.x or higher
- **npm** or **yarn**
- **Git**
- **SimpleAudience account** with credentials

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd SimpleAudienceMobile
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install all workspace dependencies
cd backend && npm install
cd ../mobile && npm install
cd ../shared && npm install
cd ..
```

Or use the workspace install:

```bash
npm install
```

### 3. Configure Environment Variables

#### Backend Configuration

Create `backend/.env`:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
# Server
PORT=3001
NODE_ENV=development

# SimpleAudience Credentials
SIMPLEAUDIENCE_EMAIL=your-email@example.com
SIMPLEAUDIENCE_PASSWORD=your-password
SIMPLEAUDIENCE_BASE_URL=https://app.simpleaudience.io

# Google Drive (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

# Database
DATABASE_PATH=./data/simpleaudience.db

# Browser
HEADLESS=true
BROWSER_TIMEOUT=30000

# Logging
LOG_LEVEL=info
```

#### Frontend Configuration

Create `mobile/.env.local`:

```bash
cp mobile/.env.local.example mobile/.env.local
```

Edit `mobile/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

### 4. Start Development Servers

#### Option 1: Start Both Servers Together

```bash
npm run dev
```

This will start:
- Backend API on http://localhost:3001
- Frontend UI on http://localhost:3000

#### Option 2: Start Servers Individually

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd mobile
npm run dev
```

### 5. Access the Application

Open your browser and navigate to:
- **Frontend:** http://localhost:3000
- **API:** http://localhost:3001/api

## Feature Highlights

- The 10-step audience builder now exposes all financial controls, including **Credit Card User (Yes/No)** and **Mortgage Amount (min/max)** inputs.
- Personal targeting supports the full 305-item **Occupation Type** taxonomy with a searchable dropdown to keep intent prompts grounded in real buyer roles.

## Production Build

### 1. Build Backend

```bash
cd backend
npm run build
```

This creates a `dist/` folder with compiled JavaScript.

### 2. Build Frontend

```bash
cd mobile
npm run build
```

This creates a `.next/` folder with optimized production build.

### 3. Start Production Servers

```bash
# Backend
cd backend
npm start

# Frontend (in another terminal)
cd mobile
npm start
```

## Docker Installation (Optional)

### Backend Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
```

### Frontend Dockerfile

Create `mobile/Dockerfile`:

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:18-alpine AS runner

WORKDIR /app

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 3000

CMD ["npm", "start"]
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - SIMPLEAUDIENCE_EMAIL=${SIMPLEAUDIENCE_EMAIL}
      - SIMPLEAUDIENCE_PASSWORD=${SIMPLEAUDIENCE_PASSWORD}
    volumes:
      - ./backend/data:/app/data
      - ./backend/logs:/app/logs

  frontend:
    build: ./mobile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:3001/api
    depends_on:
      - backend
```

Run with:

```bash
docker-compose up -d
```

## Troubleshooting

### Port Already in Use

If port 3000 or 3001 is already in use:

```bash
# Change backend port
# Edit backend/.env: PORT=3002

# Change frontend port
cd mobile
npm run dev -- -p 3001
```

### Puppeteer Installation Issues

If Puppeteer fails to install Chromium:

```bash
cd backend
npm install puppeteer --unsafe-perm=true --allow-root
```

For Alpine Linux:

```bash
apk add chromium
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### Database Locked Error

If SQLite database is locked:

```bash
cd backend/data
rm simpleaudience.db
# Restart backend to recreate database
```

### Module Not Found Errors

If you see "module not found" errors:

```bash
# Clear all node_modules
rm -rf node_modules backend/node_modules mobile/node_modules shared/node_modules

# Reinstall
npm install
cd backend && npm install
cd ../mobile && npm install
cd ../shared && npm install
```

### TypeScript Errors

```bash
# Rebuild TypeScript
cd backend && npm run build
cd ../mobile && npm run build
cd ../shared && npm run build
```

## Next Steps

After installation:

1. **Test the API**: Visit http://localhost:3001/api/health
2. **Create an audience**: Open http://localhost:3000 and click "Create Audience"
3. **Check logs**: View `backend/logs/combined.log` for debugging
4. **Update XPath selectors**: Edit `backend/src/utils/selectors.ts` to match SimpleAudience UI

## Additional Resources

- [API Documentation](./API.md)
- [Development Guide](./DEVELOPMENT.md)
- [Deployment Guide](./DEPLOYMENT.md)
