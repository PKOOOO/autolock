// =============================================================
// GET /api/session/status/[locker_id]
// =============================================================
//
// ESP32 polls this endpoint every 5 seconds after initiating
// payment to check if M-Pesa payment is confirmed and the PIN
// is ready.
//
// Responses:
//   { paid: false }                    — still waiting for payment
//   { paid: true, pin: "1234" }        — payment confirmed, here's the PIN
//
// Security:
//   - PIN is returned ONLY ONCE via this endpoint. After the
//     first successful poll, otp_plain is nulled and otp_delivered
//     is set to true. The pin_code column retains the PIN for
//     later retrieval verification.
//
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface RouteParams {
    params: Promise<{ locker_id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { locker_id } = await params;

        if (!locker_id) {
            return NextResponse.json(
                { paid: false, error: 'Missing locker_id' },
                { status: 400 }
            );
        }

        // --- Look for a paid session with an undelivered PIN ---
        const sessions = await sql`
      SELECT id, otp_plain, otp_delivered, status
      FROM sessions
      WHERE locker_id = ${locker_id}
        AND status = 'paid'
        AND otp_delivered = FALSE
        AND otp_plain IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;

        // No paid session with PIN ready
        if (sessions.length === 0) {
            return NextResponse.json({ paid: false });
        }

        const session = sessions[0];
        const pin = session.otp_plain;

        // --- Deliver PIN and mark as delivered (atomic update) ---
        // Also set status back to 'active' — goods are about to be stored
        await sql`
      UPDATE sessions
      SET otp_delivered = TRUE,
          otp_plain = NULL,
          status = 'active'
      WHERE id = ${session.id}
        AND otp_delivered = FALSE
    `;

        console.log(`[STATUS] PIN delivered for locker ${locker_id}, session ${session.id}`);

        return NextResponse.json({
            paid: true,
            pin: pin,
        });

    } catch (error) {
        console.error('[STATUS] Error:', error);
        return NextResponse.json(
            { paid: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
