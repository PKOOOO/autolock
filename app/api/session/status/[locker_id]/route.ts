// =============================================================
// GET /api/session/status/[locker_id]
// =============================================================
//
// ESP32 polls this endpoint every 5 seconds to check if
// payment has been confirmed and an OTP is ready.
//
// Responses:
//   { paid: false }                    — still waiting for payment
//   { paid: true, otp: "1234" }        — payment confirmed, here's the OTP
//
// Security:
//   - OTP is returned ONLY ONCE. After the first successful poll,
//     otp_plain is nulled and otp_delivered is set to true.
//   - Rate limiting via simple timestamp check (future enhancement).
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

        // --- Look for a paid session with an undelivered OTP ---
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

        // No paid session with OTP ready
        if (sessions.length === 0) {
            return NextResponse.json({ paid: false });
        }

        const session = sessions[0];
        const otp = session.otp_plain;

        // --- Deliver OTP and mark as delivered (atomic update) ---
        // Keep status as 'paid' — ESP32 will call /session/end after retrieval
        await sql`
      UPDATE sessions
      SET otp_delivered = TRUE,
          otp_plain = NULL
      WHERE id = ${session.id}
        AND otp_delivered = FALSE
    `;

        console.log(`[STATUS] OTP delivered for locker ${locker_id}, session ${session.id}`);

        return NextResponse.json({
            paid: true,
            otp: otp,
        });

    } catch (error) {
        console.error('[STATUS] Error:', error);
        return NextResponse.json(
            { paid: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
