// =============================================================
// POST /api/webhook/paystack
// =============================================================
// On charge.success:
//   - Finds session by paystack_ref
//   - Generates 4-digit OTP
//   - Updates session: pending_payment → paid
//   - ESP32 will pick up OTP on next poll
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyWebhookSignature, generateOTP, hashOTP } from '@/lib/paystack';

export async function POST(request: NextRequest) {
    try {
        const rawBody = await request.text();
        const signature = request.headers.get('x-paystack-signature') || '';

        if (!verifyWebhookSignature(rawBody, signature)) {
            console.warn('[WEBHOOK] Invalid signature — rejecting');
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        const event = JSON.parse(rawBody);
        console.log(`[WEBHOOK] Event: ${event.event}`);

        if (event.event === 'charge.success') {
            const reference = event.data.reference;
            console.log(`[WEBHOOK] Payment success — ref: ${reference}`);

            const sessions = await sql`
        SELECT id, status FROM sessions
        WHERE paystack_ref = ${reference}
        LIMIT 1
      `;

            if (sessions.length === 0) {
                console.warn(`[WEBHOOK] No session for ref: ${reference}`);
                return NextResponse.json({ received: true });
            }

            const session = sessions[0];

            // Only process pending_payment sessions (retrieval flow)
            if (session.status !== 'pending_payment') {
                console.log(`[WEBHOOK] Session ${session.id} status is ${session.status}, skipping`);
                return NextResponse.json({ received: true });
            }

            // Generate OTP for ESP32
            const otp = generateOTP();
            const otpHash = hashOTP(otp);

            console.log(`[WEBHOOK] OTP for session ${session.id}: ${otp}`);

            await sql`
        UPDATE sessions
        SET status = 'paid',
            otp_hash = ${otpHash},
            otp_plain = ${otp},
            otp_delivered = FALSE
        WHERE id = ${session.id}
          AND status = 'pending_payment'
      `;
        }

        return NextResponse.json({ received: true });

    } catch (error) {
        console.error('[WEBHOOK] Error:', error);
        return NextResponse.json({ received: true });
    }
}
