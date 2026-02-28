// =============================================================
// GET /api/dashboard
// =============================================================
//
// Returns all sessions for the web dashboard UI.
// Includes computed fields like minutes_used for active sessions.
//
// Response: { success: true, sessions: [...] }
//
// =============================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
    try {
        // --- Fetch all sessions, newest first ---
        const sessions = await sql`
      SELECT
        id,
        locker_id,
        phone,
        status,
        otp_delivered,
        amount_initial,
        amount_final,
        started_at,
        ended_at,
        created_at,
        -- Compute minutes_used for active sessions
        CASE
          WHEN status = 'active' AND started_at IS NOT NULL
            THEN CEIL(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)
          WHEN status = 'ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL
            THEN CEIL(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)
          ELSE 0
        END AS minutes_used,
        -- Compute running cost for active sessions
        CASE
          WHEN status = 'active' AND started_at IS NOT NULL
            THEN CEIL(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60) * 5
          ELSE amount_final
        END AS current_cost
      FROM sessions
      ORDER BY created_at DESC
      LIMIT 100
    `;

        return NextResponse.json({
            success: true,
            count: sessions.length,
            sessions,
        });

    } catch (error) {
        console.error('[DASHBOARD] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
