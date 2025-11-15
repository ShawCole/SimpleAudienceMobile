# Usage Examples

This guide provides practical examples for common tasks in the SimpleAudience Mobile application.

## Table of Contents
- [Creating Audiences](#creating-audiences)
- [Managing Audiences](#managing-audiences)
- [API Usage](#api-usage)
- [Automation Scripts](#automation-scripts)

---

## Creating Audiences

### Example 1: Simple Location-Based Audience

Create an audience targeting specific cities:

```typescript
// Via API
const response = await fetch('http://localhost:3001/api/audiences', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'California Tech Companies',
    filters: {
      location: {
        states: ['CA'],
        cities: ['San Francisco', 'Palo Alto', 'San Jose']
      }
    }
  })
});

const { data } = await response.json();
console.log('Audience created:', data.audience.id);
```

### Example 2: Intent-Based Audience

Create an audience with custom keywords:

```typescript
const audience = {
  name: 'SaaS Buyers',
  filters: {
    intent: {
      type: 'custom',
      keywords: [
        'cloud software',
        'subscription service',
        'enterprise platform'
      ],
      score: 'high'
    }
  }
};

const result = await apiClient.createAudience(audience);
```

### Example 3: AI-Generated Intent

Use AI to generate intent keywords:

```typescript
// Step 1: Generate keywords
const intentResponse = await apiClient.generateIntent(
  'Companies looking for remote work collaboration tools for distributed teams'
);

console.log('Generated keywords:', intentResponse.keywords);
// ["video conferencing", "team messaging", "project management"]

// Step 2: Create audience with AI keywords
const audience = {
  name: 'Remote Work Tools Buyers',
  filters: {
    intent: {
      type: 'ai_generated',
      aiPrompt: 'Companies looking for remote work collaboration tools',
      score: intentResponse.suggestedScore
    }
  }
};

await apiClient.createAudience(audience);
```

### Example 4: Multi-Filter Audience

Combine location and intent filters:

```typescript
const complexAudience = {
  name: 'NYC Healthcare Tech Startups',
  filters: {
    location: {
      cities: ['New York'],
      states: ['NY'],
      zipCodes: ['10001', '10002', '10003']
    },
    intent: {
      type: 'custom',
      keywords: [
        'healthcare IT',
        'medical software',
        'telemedicine',
        'EHR platform'
      ],
      score: 'medium'
    }
  }
};

const result = await apiClient.createAudience(complexAudience);
console.log(`Audience ${result.id} is now ${result.status}`);
```

---

## Managing Audiences

### Example 5: Monitor Audience Status

Poll an audience until it's completed:

```typescript
async function waitForCompletion(audienceId: string): Promise<void> {
  let status = 'building';

  while (status !== 'completed' && status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s

    const audience = await apiClient.getAudience(audienceId);
    status = audience.status;

    console.log(`Status: ${status}, Size: ${audience.size || 'N/A'}`);

    if (status === 'failed') {
      throw new Error('Audience generation failed');
    }
  }

  console.log('Audience completed successfully!');
}

// Usage
const newAudience = await apiClient.createAudience({ ... });
await waitForCompletion(newAudience.id);
```

### Example 6: Scheduled Refresh

Set up automatic weekly refresh:

```typescript
const audienceId = 'abc-123-def';

// Schedule weekly refresh
await apiClient.refreshAudience(audienceId, {
  schedule: '7_days'
});

console.log('Audience will refresh every 7 days');
```

### Example 7: Bulk Duplicate

Create multiple variants of an audience:

```typescript
const originalId = 'original-audience-id';
const variants = [
  'Variant A - High Intent',
  'Variant B - Medium Intent',
  'Variant C - Low Intent'
];

const duplicated = await Promise.all(
  variants.map(name => apiClient.duplicateAudience(originalId, name))
);

console.log(`Created ${duplicated.length} variants`);
```

### Example 8: Batch Delete

Delete multiple audiences:

```typescript
async function deleteOldAudiences(daysOld: number): Promise<void> {
  const { audiences } = await apiClient.getAudiences(1, 100);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const toDelete = audiences.filter(
    a => new Date(a.createdAt) < cutoffDate
  );

  console.log(`Deleting ${toDelete.length} old audiences...`);

  for (const audience of toDelete) {
    await apiClient.deleteAudience(audience.id);
    console.log(`Deleted: ${audience.name}`);
  }
}

// Delete audiences older than 30 days
await deleteOldAudiences(30);
```

---

## API Usage

### Example 9: Complete TypeScript Client

```typescript
import axios from 'axios';

class SimpleAudienceClient {
  private baseUrl = 'http://localhost:3001/api';

  async createAndMonitor(audienceConfig: any): Promise<any> {
    // Create
    const createRes = await axios.post(
      `${this.baseUrl}/audiences`,
      audienceConfig
    );

    const { audience } = createRes.data.data;
    console.log(`Created audience: ${audience.id}`);

    // Monitor
    let completed = false;
    while (!completed) {
      await new Promise(r => setTimeout(r, 5000));

      const statusRes = await axios.get(
        `${this.baseUrl}/audiences/${audience.id}`
      );

      const current = statusRes.data.data.audience;
      console.log(`Status: ${current.status}`);

      if (current.status === 'completed') {
        completed = true;
        return current;
      }

      if (current.status === 'failed') {
        throw new Error('Generation failed');
      }
    }
  }
}

// Usage
const client = new SimpleAudienceClient();
const result = await client.createAndMonitor({
  name: 'Test Audience',
  filters: { location: { states: ['CA'] } }
});
```

### Example 10: Retry with Exponential Backoff

```typescript
async function createWithRetry(
  config: any,
  maxRetries = 3
): Promise<any> {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiClient.createAudience(config);
    } catch (error) {
      lastError = error;
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      console.log(`Attempt ${i + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Usage
const audience = await createWithRetry({
  name: 'Retry Test',
  filters: { ... }
});
```

---

## Automation Scripts

### Example 11: Nightly Audience Refresh

Cron job to refresh all active audiences:

```typescript
#!/usr/bin/env node
import { apiClient } from './src/services/api-client';

async function refreshAllAudiences() {
  console.log('Starting nightly refresh...');

  const { audiences } = await apiClient.getAudiences(1, 1000);

  const active = audiences.filter(a => a.status === 'completed');

  console.log(`Found ${active.length} active audiences`);

  for (const audience of active) {
    try {
      await apiClient.refreshAudience(audience.id);
      console.log(`✓ Refreshed: ${audience.name}`);
    } catch (error) {
      console.error(`✗ Failed to refresh ${audience.name}:`, error);
    }
  }

  console.log('Nightly refresh complete');
}

refreshAllAudiences().catch(console.error);
```

**Cron setup (Linux/Mac):**
```bash
# Add to crontab
0 2 * * * cd /path/to/project && node scripts/nightly-refresh.js
```

### Example 12: Audience Export Script

Export all audiences to CSV:

```typescript
import { writeFileSync } from 'fs';
import { apiClient } from './src/services/api-client';

async function exportAudiences() {
  const { audiences } = await apiClient.getAudiences(1, 1000);

  const csv = [
    'ID,Name,Status,Size,Created,Last Refreshed',
    ...audiences.map(a => [
      a.id,
      `"${a.name}"`,
      a.status,
      a.size || '',
      a.createdAt,
      a.lastRefreshed || ''
    ].join(','))
  ].join('\n');

  writeFileSync('audiences-export.csv', csv);
  console.log('Exported to audiences-export.csv');
}

exportAudiences().catch(console.error);
```

### Example 13: Webhook Notification Handler

Express server to receive webhook notifications:

```typescript
import express from 'express';

const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  const { event, audience } = req.body;

  console.log(`Webhook received: ${event}`);
  console.log(`Audience: ${audience.name} (${audience.id})`);

  switch (event) {
    case 'completed':
      console.log(`✓ Audience generation completed`);
      console.log(`  Size: ${audience.size}`);
      break;

    case 'refreshed':
      console.log(`✓ Audience refreshed`);
      break;

    case 'csv_ready':
      console.log(`✓ CSV download available`);
      break;
  }

  res.status(200).send('OK');
});

app.listen(3002, () => {
  console.log('Webhook server listening on port 3002');
});
```

### Example 14: Batch Import from CSV

Import audience configurations from CSV:

```typescript
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

async function importFromCSV(filePath: string) {
  const csvContent = readFileSync(filePath, 'utf-8');
  const records = parse(csvContent, { columns: true });

  for (const record of records) {
    const audience = {
      name: record.name,
      filters: {
        location: {
          states: record.states?.split(';'),
          cities: record.cities?.split(';')
        },
        intent: {
          type: 'custom' as const,
          keywords: record.keywords?.split(';'),
          score: record.intent_score as any
        }
      }
    };

    try {
      const result = await apiClient.createAudience(audience);
      console.log(`✓ Created: ${result.name}`);
    } catch (error) {
      console.error(`✗ Failed to create ${record.name}:`, error);
    }
  }
}

// CSV format:
// name,states,cities,keywords,intent_score
// "CA Tech","CA","San Francisco;Palo Alto","cloud;SaaS","high"
```

---

## React Hook Examples

### Example 15: Custom Hook for Audience Operations

```typescript
import { useState } from 'react';
import { apiClient } from '../services/api-client';
import { useAudiences } from './use-audiences';

export function useAudienceOperations() {
  const [loading, setLoading] = useState<string | null>(null);
  const { mutate } = useAudiences();

  const refresh = async (id: string, schedule?: string) => {
    setLoading('refresh');
    try {
      await apiClient.refreshAudience(id, { schedule });
      await mutate(); // Refresh SWR cache
      return true;
    } catch (error) {
      console.error('Refresh failed:', error);
      return false;
    } finally {
      setLoading(null);
    }
  };

  const duplicate = async (id: string, newName: string) => {
    setLoading('duplicate');
    try {
      const result = await apiClient.duplicateAudience(id, newName);
      await mutate();
      return result;
    } catch (error) {
      console.error('Duplicate failed:', error);
      return null;
    } finally {
      setLoading(null);
    }
  };

  const remove = async (id: string) => {
    setLoading('delete');
    try {
      await apiClient.deleteAudience(id);
      await mutate();
      return true;
    } catch (error) {
      console.error('Delete failed:', error);
      return false;
    } finally {
      setLoading(null);
    }
  };

  return { refresh, duplicate, remove, loading };
}
```

**Usage in Component:**

```typescript
function AudienceActions({ audienceId }: { audienceId: string }) {
  const { refresh, duplicate, remove, loading } = useAudienceOperations();

  const handleRefresh = async () => {
    const success = await refresh(audienceId, '7_days');
    if (success) toast.success('Refresh scheduled');
  };

  const handleDuplicate = async () => {
    const newName = prompt('Enter new name:');
    if (newName) {
      const result = await duplicate(audienceId, newName);
      if (result) toast.success('Duplicated successfully');
    }
  };

  return (
    <div>
      <button onClick={handleRefresh} disabled={!!loading}>
        Refresh
      </button>
      <button onClick={handleDuplicate} disabled={!!loading}>
        Duplicate
      </button>
    </div>
  );
}
```

---

These examples demonstrate the full capabilities of the SimpleAudience Mobile application. For more details, see the [API Documentation](./API.md).
