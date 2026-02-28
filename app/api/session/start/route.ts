// =============================================================
// POST /api/session/start
// =============================================================
//
// Starts a new storage session:
//   1. Receives { phone, locker_id } from the web app
//   2. Creates a "pending" session in the database
//   3. Initiates an M-Pesa STK push for KES 10 initial fee
//   4. Returns { success, session_id }
//
// The actual payment confirmation happens asynchronously via
// the Paystack webhook (/api/webhook/paystack).
//
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { initiateMpesaCharge } from '@/lib/paystack';
import crypto from 'crypto';

const INITIAL_FEE_KES = 10;

export async function POST(request: NextRequest) {
    try {
        // --- Parse request body ---
        const body = await request.json();
        const { phone, locker_id } = body;

        if (!phone || !locker_id) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields: phone, locker_id' },
                { status: 400 }
            );
        }

        console.log(`[SESSION/START] Phone: ${phone}, Locker: ${locker_id}`);

        // --- Check if locker already has an active session ---
        const existing = await sql`
      SELECT id FROM sessions
      WHERE locker_id = ${locker_id}
        AND status IN ('pending', 'paid', 'active')
      LIMIT 1
    `;

        if (existing.length > 0) {
            return NextResponse.json(
                { success: false, error: 'Locker already has an active session' },
                { status: 409 }
            );
        }

        // --- Generate unique payment reference ---
        const reference = `autolock_${locker_id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        // --- Create pending session in database ---
        const result = await sql`
      INSERT INTO sessions (locker_id, phone, status, paystack_ref, amount_initial)
      VALUES (${locker_id}, ${phone}, 'pending', ${reference}, ${INITIAL_FEE_KES})
      RETURNING id
    `;

        const sessionId = result[0].id;
        console.log(`[SESSION/START] Created session: ${sessionId}`);

        // --- Initiate M-Pesa STK push ---
        const charge = await initiateMpesaCharge(phone, INITIAL_FEE_KES, reference);

        console.log(`[SESSION/START] Paystack response: ${charge.message}`);

        if (!charge.success) {
            // Mark session as failed if charge initiation fails
            await sql`
        UPDATE sessions SET status = 'failed' WHERE id = ${sessionId}
      `;

            return NextResponse.json(
                { success: false, error: 'Failed to initiate payment', details: charge.message },
                { status: 502 }
            );
        }

        // --- Success: session created, STK push sent ---
        return NextResponse.json({
            success: true,
            session_id: sessionId,
            message: 'Payment prompt sent to your phone. Enter M-Pesa PIN to confirm.',
        });

    } catch (error) {
        console.error('[SESSION/START] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
