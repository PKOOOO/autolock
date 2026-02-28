// =============================================================
// POST /api/session/end
// =============================================================
// Called by ESP32 after customer retrieves goods.
// Marks the session as "ended" with final timestamp.
//
// Receives: { locker_id }
// Returns:  { success }
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { locker_id } = body;

        if (!locker_id) {
            return NextResponse.json(
                { success: false, error: 'Missing locker_id' },
                { status: 400 }
            );
        }

        console.log(`[SESSION/END] Ending session for locker: ${locker_id}`);

        // Find the session that's been paid (goods retrieved)
        const result = await sql`
      UPDATE sessions
      SET status = 'ended',
          ended_at = NOW()
      WHERE locker_id = ${locker_id}
        AND status IN ('paid', 'active', 'pending_payment')
      RETURNING id, amount_final
    `;

        if (result.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No active session to end' },
                { status: 404 }
            );
        }

        console.log(`[SESSION/END] Session ${result[0].id} ended. Fee: KES ${result[0].amount_final}`);

        return NextResponse.json({
            success: true,
            session_id: result[0].id,
            amount: result[0].amount_final || 0,
        });

    } catch (error) {
        console.error('[SESSION/END] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
