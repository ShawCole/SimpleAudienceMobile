import { AudiencePayload } from '@shared/types/audience-payload';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const AudienceApi = {
    // 1. The "Live Preview" Call (Vacuum)
    async preview(payload: AudiencePayload) {
        const res = await fetch(`${API_URL}/api/audiences/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error?.message || 'Preview Failed');
        }

        return res.json(); // Returns { success: true, data: { count, preview: [...] } }
    },

    // 2. The "Commit/Generate" Call (Vacuum)
    async generate(payload: AudiencePayload) {
        const res = await fetch(`${API_URL}/api/audiences/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error?.message || 'Generation Failed');
        }

        return res.json(); // Returns { success: true, data: { status: 'QUEUED' } }
    },

    // 3. The "Save Draft" Call (Local DB) - Existing Logic
    async createLocal(name: string, filters: any) {
        const res = await fetch(`${API_URL}/api/audiences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, filters }),
        });
        return res.json();
    }
};