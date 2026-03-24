// =============================================================
// POST /api/session/unlock
// =============================================================
// Called when customer returns and enters their 4-digit PIN.
// No payment needed — they already paid at storage time.
//
// Receives: { locker_id, pin }
// Returns:  { success } or { success: false, error }
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { locker_id, pin } = body;

        if (!locker_id || !pin) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields: locker_id, pin' },
                { status: 400 }
            );
        }

        console.log(`[UNLOCK] Locker: ${locker_id}, PIN attempt: ${pin}`);

        // Find the active (stored) session for this locker
        const sessions = await sql`
            SELECT id, pin_code, status
            FROM sessions
            WHERE locker_id = ${locker_id}
              AND status = 'active'
              AND pin_code IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
        `;

        if (sessions.length === 0) {
            console.log(`[UNLOCK] No active session found for locker ${locker_id}`);
            return NextResponse.json(
                { success: false, error: 'No stored items' },
                { status: 404 }
            );
        }

        const session = sessions[0];

        // Verify PIN
        if (session.pin_code !== pin) {
            console.log(`[UNLOCK] Wrong PIN for session ${session.id}`);
            return NextResponse.json(
                { success: false, error: 'Wrong PIN' },
                { status: 403 }
            );
        }

        // PIN matches — mark session as retrieving
        await sql`
            UPDATE sessions
            SET status = 'retrieving'
            WHERE id = ${session.id}
        `;

        console.log(`[UNLOCK] PIN verified! Session ${session.id} — unlocking`);

        return NextResponse.json({
            success: true,
            session_id: session.id,
        });

    } catch (error) {
        console.error('[UNLOCK] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
