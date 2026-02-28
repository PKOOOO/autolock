// =============================================================
// POST /api/session/start
// =============================================================
// Called when customer STORES goods (no payment, free).
// Creates an active session with timer started.
//
// Receives: { locker_id }
// Returns:  { success, session_id }
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { locker_id } = body;

        if (!locker_id) {
            return NextResponse.json(
                { success: false, error: 'Missing required field: locker_id' },
                { status: 400 }
            );
        }

        console.log(`[SESSION/START] Locker: ${locker_id} — storing goods (free)`);

        // Check if locker already has an active session
        const existing = await sql`
      SELECT id FROM sessions
      WHERE locker_id = ${locker_id}
        AND status IN ('active', 'pending_payment', 'paid')
      LIMIT 1
    `;

        if (existing.length > 0) {
            return NextResponse.json(
                { success: false, error: 'Locker already has an active session' },
                { status: 409 }
            );
        }

        // Create active session — timer starts NOW, no payment
        const result = await sql`
      INSERT INTO sessions (locker_id, phone, status, started_at)
      VALUES (${locker_id}, '', 'active', NOW())
      RETURNING id
    `;

        const sessionId = result[0].id;
        console.log(`[SESSION/START] Session created: ${sessionId} — timer started`);

        return NextResponse.json({
            success: true,
            session_id: sessionId,
        });

    } catch (error) {
        console.error('[SESSION/START] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
