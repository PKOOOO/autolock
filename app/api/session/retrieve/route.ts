// =============================================================
// POST /api/session/retrieve
// =============================================================
// Called when customer wants to RETRIEVE goods.
// Calculates time elapsed, charges KES 1/minute via M-Pesa.
//
// Receives: { locker_id, phone }
// Returns:  { success, minutes_used, amount }
//
// After payment, Paystack webhook fires → OTP generated →
// ESP32 polls status → gets OTP → unlocks.
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { initiateMpesaCharge } from '@/lib/paystack';
import crypto from 'crypto';

const FLAT_RATE_KES = 10;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { locker_id, phone } = body;

        if (!locker_id || !phone) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields: locker_id, phone' },
                { status: 400 }
            );
        }

        console.log(`[RETRIEVE] Locker: ${locker_id}, Phone: ${phone}`);

        // Find active session for this locker
        const sessions = await sql`
      SELECT id, started_at
      FROM sessions
      WHERE locker_id = ${locker_id}
        AND status IN ('active', 'pending_payment')
      ORDER BY created_at DESC
      LIMIT 1
    `;

        if (sessions.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No active session for this locker' },
                { status: 404 }
            );
        }

        const session = sessions[0];
        const startedAt = new Date(session.started_at);
        const now = new Date();

        // Calculate time for display only — flat rate KES 10
        const diffMs = now.getTime() - startedAt.getTime();
        const minutesUsed = Math.max(1, Math.ceil(diffMs / 60000));
        const amount = FLAT_RATE_KES;

        console.log(`[RETRIEVE] Duration: ${minutesUsed}m, Cost: KES ${amount}`);

        // Generate payment reference
        const reference = `autolock_ret_${locker_id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        // Update session with phone and payment info
        await sql`
      UPDATE sessions
      SET phone = ${phone},
          status = 'pending_payment',
          paystack_ref = ${reference},
          amount_final = ${amount}
      WHERE id = ${session.id}
    `;

        // Send M-Pesa STK push
        const charge = await initiateMpesaCharge(phone, amount, reference);

        console.log(`[RETRIEVE] Paystack: ${charge.message}`);

        if (!charge.success) {
            // Leave session as pending_payment — the retrieve query matches
            // both 'active' and 'pending_payment', so the user can retry.

            return NextResponse.json(
                { success: false, error: 'Payment failed', details: charge.message },
                { status: 502 }
            );
        }

        return NextResponse.json({
            success: true,
            session_id: session.id,
            minutes_used: minutesUsed,
            amount: amount,
            message: `KES ${amount} for ${minutesUsed} min. Check phone to pay.`,
        });

    } catch (error) {
        console.error('[RETRIEVE] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
