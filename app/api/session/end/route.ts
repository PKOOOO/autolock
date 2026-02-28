// =============================================================
// POST /api/session/end
// =============================================================
//
// Ends an active storage session:
//   1. Receives { locker_id }
//   2. Finds the active session for that locker
//   3. Calculates time used (ceiling to nearest minute)
//   4. Charges user via M-Pesa STK push (KES 5 per minute)
//   5. Updates session to "ended"
//   6. Returns { success, amount_charged, minutes_used }
//
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { initiateMpesaCharge } from '@/lib/paystack';
import crypto from 'crypto';

const RATE_PER_MINUTE_KES = 5;

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

        // --- Find the active session for this locker ---
        const sessions = await sql`
      SELECT id, phone, started_at, paystack_ref
      FROM sessions
      WHERE locker_id = ${locker_id}
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `;

        if (sessions.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No active session found for this locker' },
                { status: 404 }
            );
        }

        const session = sessions[0];
        const startedAt = new Date(session.started_at);
        const now = new Date();

        // --- Calculate usage time (ceiling to nearest minute, minimum 1) ---
        const diffMs = now.getTime() - startedAt.getTime();
        const minutesUsed = Math.max(1, Math.ceil(diffMs / 60000));
        const amountCharged = minutesUsed * RATE_PER_MINUTE_KES;

        console.log(`[SESSION/END] Locker: ${locker_id}`);
        console.log(`[SESSION/END] Duration: ${minutesUsed} min, Charge: KES ${amountCharged}`);

        // --- Initiate final M-Pesa charge ---
        const reference = `autolock_end_${locker_id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        const charge = await initiateMpesaCharge(
            session.phone,
            amountCharged,
            reference
        );

        console.log(`[SESSION/END] Paystack response: ${charge.message}`);

        // --- Update session regardless of charge result ---
        // (We still end the session even if the final charge fails —
        //  the locker needs to be freed. Failed charges can be retried later.)
        await sql`
      UPDATE sessions
      SET status = 'ended',
          ended_at = NOW(),
          amount_final = ${amountCharged}
      WHERE id = ${session.id}
    `;

        return NextResponse.json({
            success: true,
            session_id: session.id,
            minutes_used: minutesUsed,
            amount_charged: amountCharged,
            charge_status: charge.success ? 'sent' : 'failed',
            message: charge.success
                ? `Payment of KES ${amountCharged} sent to phone. Session ended.`
                : `Session ended. Payment of KES ${amountCharged} failed — will retry.`,
        });

    } catch (error) {
        console.error('[SESSION/END] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
