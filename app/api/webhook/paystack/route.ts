// =============================================================
// POST /api/webhook/paystack
// =============================================================
//
// Paystack sends webhooks here when payment events occur.
//
// Flow:
//   1. Verify HMAC SHA-512 signature (reject if invalid)
//   2. On "charge.success" event:
//      a. Find the session by paystack_ref
//      b. Generate a 4-digit OTP
//      c. Store OTP hash + plain text in the session
//      d. Update session status to "paid"
//   3. Return 200 (Paystack requires 200 within 5 seconds)
//
// Security:
//   - Raw body is read for signature verification
//   - Invalid signatures are rejected with 401
//   - Duplicate webhooks are handled idempotently
//
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyWebhookSignature, generateOTP, hashOTP } from '@/lib/paystack';

export async function POST(request: NextRequest) {
    try {
        // --- Read raw body for signature verification ---
        const rawBody = await request.text();
        const signature = request.headers.get('x-paystack-signature') || '';

        // --- Verify webhook signature ---
        if (!verifyWebhookSignature(rawBody, signature)) {
            console.warn('[WEBHOOK] Invalid signature — rejecting');
            return NextResponse.json(
                { error: 'Invalid signature' },
                { status: 401 }
            );
        }

        // --- Parse the event ---
        const event = JSON.parse(rawBody);
        const eventType = event.event;

        console.log(`[WEBHOOK] Received event: ${eventType}`);

        // --- Handle charge.success ---
        if (eventType === 'charge.success') {
            const data = event.data;
            const reference = data.reference;

            console.log(`[WEBHOOK] Payment successful — ref: ${reference}`);

            // Find session by paystack reference
            const sessions = await sql`
        SELECT id, status FROM sessions
        WHERE paystack_ref = ${reference}
        LIMIT 1
      `;

            if (sessions.length === 0) {
                console.warn(`[WEBHOOK] No session found for ref: ${reference}`);
                // Return 200 anyway — Paystack will keep retrying on non-200
                return NextResponse.json({ received: true });
            }

            const session = sessions[0];

            // Idempotency: skip if already processed
            if (session.status !== 'pending') {
                console.log(`[WEBHOOK] Session ${session.id} already processed (status: ${session.status})`);
                return NextResponse.json({ received: true });
            }

            // --- Generate OTP ---
            const otp = generateOTP();
            const otpHash = hashOTP(otp);

            console.log(`[WEBHOOK] Generated OTP for session ${session.id}: ${otp}`);

            // --- Update session: pending → paid, store OTP ---
            await sql`
        UPDATE sessions
        SET status = 'paid',
            otp_hash = ${otpHash},
            otp_plain = ${otp},
            otp_delivered = FALSE
        WHERE id = ${session.id}
          AND status = 'pending'
      `;

            console.log(`[WEBHOOK] Session ${session.id} updated to "paid"`);
        }

        // --- Always return 200 to acknowledge receipt ---
        return NextResponse.json({ received: true });

    } catch (error) {
        console.error('[WEBHOOK] Error:', error);
        // Return 200 even on error to prevent Paystack from retrying
        // (we log the error for debugging)
        return NextResponse.json({ received: true });
    }
}
