# API Documentation

Base URL: `http://localhost:3001/api`

## Authentication

Currently, the API does not require authentication. All requests to SimpleAudience are authenticated using credentials in `.env`.

## Common Response Format

All API responses follow this structure:

```typescript
{
  "success": boolean,
  "data": any,              // Present on success
  "error": {                // Present on failure
    "code": string,
    "message": string,
    "details": any          // Optional, only in development
  },
  "timestamp": string       // ISO 8601 date
}
```

## Endpoints

### Health Check

**GET** `/health`

Check if the API is running.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2024-01-15T10:00:00.000Z"
  }
}
```

---

### Get All Audiences

**GET** `/audiences`

Retrieve a paginated list of all audiences.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `pageSize` (optional): Items per page (default: 20)

**Response:**
```json
{
  "success": true,
  "data": {
    "audiences": [
      {
        "id": "uuid",
        "name": "Tech Startups CA",
        "status": "completed",
        "size": 15000,
        "previewSize": 15243,
        "createdAt": "2024-01-15T10:00:00.000Z",
        "updatedAt": "2024-01-15T12:00:00.000Z",
        "lastRefreshed": "2024-01-15T12:00:00.000Z",
        "refreshCount": 2,
        "nextRefresh": null,
        "filters": { ... }
      }
    ],
    "total": 45,
    "page": 1,
    "pageSize": 20
  }
}
```

---

### Get Audience by ID

**GET** `/audiences/:id`

Get details of a specific audience.

**Response:**
```json
{
  "success": true,
  "data": {
    "audience": {
      "id": "uuid",
      "name": "Tech Startups CA",
      "status": "completed",
      ...
    }
  }
}
```

---

### Create Audience

**POST** `/audiences`

Create a new audience with filters.

**Request Body:**
```json
{
  "name": "Tech Startups CA",
  "filters": {
    "location": {
      "cities": ["San Francisco", "Los Angeles"],
      "states": ["CA"],
      "zipCodes": ["94102", "90001"]
    },
    "intent": {
      "type": "custom",
      "keywords": ["cloud computing", "SaaS"],
      "score": "medium"
    },
    "financial": {
      "netWorth": [8, 9, 10],
      "creditCardUser": [0],
      "mortgageAmount": { "min": 250000, "max": 1000000 }
    },
    "personal": {
      "occupationType": [4, 11, 12]
    }
  }
}
```

> Indices used in `netWorth`, `creditCardUser`, and `occupationType` reference the canonical tables in `docs/audience_filter_options_grouped*.md` (e.g., `creditCardUser: [0]` = Yes).

**Response:**
```json
{
  "success": true,
  "data": {
    "audience": {
      "id": "new-uuid",
      "name": "Tech Startups CA",
      "status": "building",
      ...
    }
  }
}
```

---

### Refresh Audience

**POST** `/audiences/:id/refresh`

Refresh an audience to get updated data.

**Request Body (Optional):**
```json
{
  "schedule": "7_days"  // Options: "manual", "everyday", "3_days", "7_days", "14_days", "monthly"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Audience refresh started"
  }
}
```

---

### Duplicate Audience

**POST** `/audiences/:id/duplicate`

Create a copy of an existing audience.

**Request Body:**
```json
{
  "newName": "Tech Startups CA - Copy"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "audience": {
      "id": "new-uuid",
      "name": "Tech Startups CA - Copy",
      ...
    }
  }
}
```

---

### Delete Audience

**DELETE** `/audiences/:id`

Permanently delete an audience.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Audience deleted successfully"
  }
}
```

---

### Generate AI Intent

**POST** `/intent/generate`

Generate intent keywords using AI based on a description.

**Request Body:**
```json
{
  "prompt": "Companies looking for cloud-based HR solutions for remote teams"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "keywords": [
      "HR software",
      "remote workforce management",
      "cloud HR platform"
    ],
    "suggestedScore": "medium"
  }
}
```

---

### Upload to Google Drive

**POST** `/drive/upload`

Upload a file to Google Drive and get a shareable link.

**Request Body:**
```json
{
  "fileId": "local-file-id",
  "fileName": "audience-export.csv"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "driveFileId": "google-drive-file-id",
    "shareableLink": "https://drive.google.com/file/d/...",
    "fileName": "audience-export.csv"
  }
}
```

---

### Get Google Auth URL

**GET** `/auth/google/url`

Get the OAuth URL for Google Drive authorization.

**Response:**
```json
{
  "success": true,
  "data": {
    "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
  }
}
```

---

### Google OAuth Callback

**GET** `/auth/google/callback?code=...`

Handle Google OAuth callback (used by OAuth flow).

**Query Parameters:**
- `code`: Authorization code from Google

**Response:**
```json
{
  "success": true,
  "data": {
    "tokens": {
      "access_token": "...",
      "refresh_token": "...",
      "scope": "...",
      "token_type": "Bearer",
      "expiry_date": 1234567890
    }
  }
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `AUDIENCE_NOT_FOUND` | Audience with given ID doesn't exist |
| `INVALID_REQUEST` | Missing or invalid request parameters |
| `CREATE_AUDIENCE_ERROR` | Failed to create audience |
| `REFRESH_AUDIENCE_ERROR` | Failed to refresh audience |
| `DUPLICATE_AUDIENCE_ERROR` | Failed to duplicate audience |
| `DELETE_AUDIENCE_ERROR` | Failed to delete audience |
| `GENERATE_INTENT_ERROR` | Failed to generate AI intent |
| `GOOGLE_DRIVE_UPLOAD_ERROR` | Failed to upload to Google Drive |
| `AUTH_URL_ERROR` | Failed to generate auth URL |
| `INTERNAL_SERVER_ERROR` | Unexpected server error |

## Rate Limiting

Currently, there is no rate limiting implemented. Consider adding rate limiting in production using `express-rate-limit`.

## WebSocket Updates (Future)

Real-time audience status updates via WebSocket are planned for future versions. The endpoint will be:

```
ws://localhost:3001/ws
```

## Examples

### cURL Examples

**Get all audiences:**
```bash
curl http://localhost:3001/api/audiences
```

**Create audience:**
```bash
curl -X POST http://localhost:3001/api/audiences \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Audience",
    "filters": {
      "location": {
        "states": ["CA", "NY"]
      }
    }
  }'
```

**Refresh audience:**
```bash
curl -X POST http://localhost:3001/api/audiences/{id}/refresh \
  -H "Content-Type: application/json" \
  -d '{"schedule": "7_days"}'
```

### JavaScript/TypeScript Examples

See `mobile/src/services/api-client.ts` for a complete TypeScript client implementation.
