# CLAUDE.md - SimpleAudience Mobile App

## Project Overview

This is a **mobile-first web application** built with Next.js that provides a complete interface for creating, managing, and automating SimpleAudience audiences. The application consists of two main components:

1. **Backend Automation Layer** - Node.js server with Puppeteer for headless browser automation
2. **Mobile UI** - Next.js responsive web app optimized for iOS, Android, and desktop

## Architecture

```
SimpleAudienceMobile/
├── backend/                 # Node.js automation engine
│   ├── src/
│   │   ├── automation/     # Browser automation & state machine
│   │   ├── api/            # REST API routes
│   │   ├── services/       # Business logic & database
│   │   └── utils/          # XPath, logging, retry utilities
│   └── data/               # SQLite database
│
├── mobile/                  # Next.js mobile UI
│   └── src/
│       ├── app/            # Next.js app router pages
│       ├── components/     # React components
│       ├── hooks/          # Custom hooks (SWR)
│       └── services/       # API client
│
└── shared/                  # Shared TypeScript types
    ├── types/              # Common interfaces
    └── utils/              # Validators & formatters
```

## Technology Stack

### Backend
- **Node.js** + **TypeScript** - Server runtime
- **Express** - REST API framework
- **Puppeteer** - Headless browser automation
- **better-sqlite3** - Embedded database
- **Winston** - Logging
- **Zod** - Schema validation

### Frontend
- **Next.js 14** (App Router) - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first styling
- **SWR** - Data fetching & caching
- **Axios** - HTTP client
- **React Hook Form** - Form handling
- **Lucide React** - Icons

## Key Features Implemented

### ✅ Complete Backend Automation
- Browser manager with Puppeteer stealth plugin
- XPath-based DOM interaction utilities
- State machine for audience creation workflow
- Retry logic with exponential backoff
- Database layer for metadata persistence
- REST API endpoints for all operations

### ✅ Mobile-First UI
- Responsive dashboard showing all audiences
- Multi-step wizard for audience creation
- Real-time status updates via SWR polling
- Audience detail view with management actions
- Touch-friendly buttons (44px minimum)
- Dark mode support

### ✅ Audience Operations
- Create audiences with filters (location, intent)
- Preview audience size
- Generate audience (with status monitoring)
- Refresh audience (manual or scheduled)
- Duplicate audience
- Delete audience (with confirmation)

## Current Implementation Status

### ✅ Fully Implemented
1. Project structure and configuration
2. Shared TypeScript types and utilities
3. Backend automation engine foundation
4. XPath utilities and DOM helpers
5. State machine for workflow management
6. Database layer (SQLite)
7. REST API endpoints
8. Mobile UI components and layouts
9. Audience dashboard
10. Audience creation wizard
11. Audience detail page

### ⚠️ Partially Implemented (Placeholders)
1. **SimpleAudience XPath Selectors** - Located in `backend/src/utils/selectors.ts`
   - Current selectors are placeholders
   - Need to be updated based on actual SimpleAudience DOM structure
   - Use browser DevTools to inspect and extract correct XPath expressions

2. **Business/Financial/Personal Filters** - In `simpleaudience-client.ts`
   - Location and Intent filters are implemented
   - Other filter types need implementation
   - Follow the same pattern as location filters

3. **Download Workflow** - Stub in `simpleaudience-client.ts`
   - Need to implement CSV download detection
   - Parse download list from popup
   - Handle file download to server

4. **Webhook System** - Database structure exists
   - Need to implement webhook triggers
   - Add HTTP POST to webhook URLs on events

5. **Status Polling** - Simplified implementation
   - Current version simulates status progression
   - Need to implement actual status scraping from SimpleAudience table

### ❌ Not Yet Implemented
1. **Google Drive Integration** - Service exists but upload logic incomplete
2. **Mobile Share Sheet** - iOS/Android native share functionality
3. **AI Intent Generation** - Currently returns placeholder keywords
4. **Advanced Filter Types** - SIC codes, NAICS, company size, etc.
5. **Webhook Testing** - UI exists but backend logic incomplete
6. **CSV File Streaming** - For large downloads
7. **Background Job Queue** - For long-running operations

## Future Iteration Priorities

### P0 (Critical)
1. **Update XPath Selectors** - Test against actual SimpleAudience UI
2. **Implement Status Polling** - Read actual status from audience table
3. **Complete Download Workflow** - CSV file handling and storage

### P1 (High Priority)
4. **Add Remaining Filters** - Business, Financial, Personal, etc.
5. **Webhook Trigger System** - Event-based HTTP notifications
6. **Google Drive Upload** - Complete file upload and sharing
7. **Error Handling UI** - Better error messages and retry options

### P2 (Nice to Have)
8. **Mobile Share Sheet** - Use Web Share API
9. **Scheduled Refreshes** - Cron-based automation
10. **Analytics Dashboard** - Audience growth trends
11. **Export to Other Platforms** - HubSpot, Salesforce, etc.

## Known Issues & Gotchas

### SimpleAudience UI Challenges
1. **Loading Spinners** - Must wait for spinners to disappear before interaction
2. **Slow Dropdowns** - Location selectors take time to populate
3. **Popup Stacking** - Multiple popups can appear simultaneously
4. **No X Buttons** - Some popups require clicking outside to close
5. **Status Lag** - Audience status updates can be delayed
6. **Missing Downloads** - Newly generated audiences may not have CSV immediately

### Technical Challenges
1. **Authentication** - SimpleAudience login flow may change
2. **Rate Limiting** - Need to throttle automation to avoid detection
3. **Mobile Safari** - Viewport height issues with iOS Safari
4. **Dark Mode Flash** - FOUC on initial page load

## How to Extend

### Adding a New Filter Type

1. **Update shared types** (`shared/types/audience.ts`):
```typescript
export interface NewFilter {
  option1?: string[];
  option2?: string[];
}

// Add to AudienceFilters
export interface AudienceFilters {
  // ... existing filters
  newFilter?: NewFilter;
}
```

2. **Add XPath selectors** (`backend/src/utils/selectors.ts`):
```typescript
export const SELECTORS = {
  // ...
  newFilterTab: '//button[contains(text(), "New Filter")]',
  newFilterInput: '//input[@name="newFilter"]',
};
```

3. **Implement automation** (`backend/src/automation/simpleaudience-client.ts`):
```typescript
private async applyNewFilter(filter: NewFilter): Promise<void> {
  const page = this.getPage();
  // Click tab
  await xpath.clickXPath(page, SELECTORS.newFilterTab);
  // Fill inputs
  await xpath.typeIntoXPath(page, SELECTORS.newFilterInput, filter.option1.join(', '));
  // Continue...
}
```

4. **Add UI components** (`mobile/src/app/create/page.tsx`):
```typescript
case 'newFilter':
  return (
    <Input
      label="New Filter Option"
      value={newFilterValue}
      onChange={(e) => setNewFilterValue(e.target.value)}
    />
  );
```

### Adding a New API Endpoint

1. **Define types** (`shared/types/api.ts`):
```typescript
export interface NewOperationRequest {
  param1: string;
  param2: number;
}

export interface NewOperationResponse {
  result: string;
}
```

2. **Add route** (`backend/src/api/routes.ts`):
```typescript
router.post('/new-operation', async (req: Request, res: Response) => {
  try {
    const { param1, param2 }: NewOperationRequest = req.body;
    // Implementation
    const response: ApiResponse = {
      success: true,
      data: { result: 'success' },
      timestamp: new Date(),
    };
    res.json(response);
  } catch (error) {
    // Error handling
  }
});
```

3. **Add client method** (`mobile/src/services/api-client.ts`):
```typescript
async newOperation(param1: string, param2: number): Promise<NewOperationResponse> {
  const response = await this.client.post<ApiResponse>('/new-operation', {
    param1,
    param2,
  });
  return response.data.data!;
}
```

## Testing Strategy

### Manual Testing Checklist
- [ ] Backend starts without errors
- [ ] Frontend builds and runs
- [ ] Can create an audience with all filter types
- [ ] Preview shows accurate counts
- [ ] Generation completes successfully
- [ ] Status updates correctly in dashboard
- [ ] Refresh works (manual and scheduled)
- [ ] Duplicate creates new audience
- [ ] Delete removes audience
- [ ] Mobile layout works on iOS/Android
- [ ] Dark mode works correctly

### Automated Testing (TODO)
- Unit tests for utilities (XPath, validators, formatters)
- Integration tests for API endpoints
- E2E tests for critical user flows
- Puppeteer screenshot comparisons

## Deployment

### Backend Deployment
```bash
cd backend
npm run build
PORT=3001 NODE_ENV=production node dist/index.js
```

### Frontend Deployment
```bash
cd mobile
npm run build
npm run start
```

### Environment Variables
See `.env.example` files in both `backend/` and `mobile/` directories.

### Production Considerations
1. **SSL/HTTPS** - Required for mobile PWA features
2. **Database Backups** - SQLite file should be backed up regularly
3. **Browser Pool** - Consider multiple Puppeteer instances for scaling
4. **Rate Limiting** - Add API rate limiting with express-rate-limit
5. **Monitoring** - Add error tracking (Sentry, Rollbar)
6. **Logging** - Centralize logs (CloudWatch, DataDog)

## Support & Maintenance

### Common Commands
```bash
# Install dependencies
npm install

# Start development
npm run dev

# Build for production
npm run build

# Start production
npm start
```

### Debugging
- Check logs in `backend/logs/`
- Enable verbose logging: `LOG_LEVEL=debug`
- Take screenshots: `browserManager.screenshot('debug.png')`
- Disable headless mode: `HEADLESS=false`

### Performance Optimization
1. Enable browser caching in Puppeteer
2. Reuse browser instances across requests
3. Implement request pooling for concurrent operations
4. Add Redis for session caching
5. Use SWR cache for frontend data

## Version History

### v1.0.0 (Current)
- Initial implementation
- Basic audience creation and management
- Mobile-first UI
- REST API backend
- SQLite database
- Puppeteer automation

## Contact & Contributing

This project is maintained as part of SimpleAudience automation tools. For questions or contributions, please refer to the main repository documentation.
