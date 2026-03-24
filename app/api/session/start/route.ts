// =============================================================
// POST /api/session/start
// =============================================================
// Called BEFORE storing — customer pays first, gets a PIN.
//
// Flow:
//   1. Customer enters phone on keypad
//   2. ESP32 calls this endpoint with { locker_id, phone }
//   3. We create session, initiate M-Pesa STK push
//   4. ESP32 polls /session/status for payment confirmation + PIN
//   5. Once paid, ESP32 displays PIN → opens lock for storing
//
// Receives: { locker_id, phone }
// Returns:  { success, session_id, amount }
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { initiateMpesaCharge, isTestMode, submitChargeOTP } from '@/lib/paystack';
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

        console.log(`[SESSION/START] Locker: ${locker_id}, Phone: ${phone}`);

        // Auto-expire stale sessions:
        // - active/pending_payment older than 10 minutes
        // - paid sessions older than 1 hour (user never stored/retrieved)
        await sql`
            UPDATE sessions SET status = 'expired'
            WHERE locker_id = ${locker_id}
              AND (
                (status IN ('active', 'pending_payment') AND created_at < NOW() - INTERVAL '10 minutes')
                OR (status = 'paid' AND created_at < NOW() - INTERVAL '1 hour')
              )
        `;

        // Check if locker still has a recent active session
        const existing = await sql`
            SELECT id FROM sessions
            WHERE locker_id = ${locker_id}
              AND status IN ('active', 'pending_payment', 'paid')
            LIMIT 1
        `;

        if (existing.length > 0) {
            return NextResponse.json(
                { success: false, error: 'Locker already has an active session' },
                { status: 409 }
            );
        }

        // Generate payment reference
        const reference = `autolock_${locker_id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        // Create session with phone and payment info
        const result = await sql`
            INSERT INTO sessions (locker_id, phone, status, paystack_ref, amount_final, started_at)
            VALUES (${locker_id}, ${phone}, 'pending_payment', ${reference}, ${FLAT_RATE_KES}, NOW())
            RETURNING id
        `;

        const sessionId = result[0].id;
        console.log(`[SESSION/START] Session created: ${sessionId}, initiating payment...`);

        // Send M-Pesa STK push
        const charge = await initiateMpesaCharge(phone, FLAT_RATE_KES, reference);

        console.log(`[SESSION/START] Paystack: ${charge.message}`);

        if (!charge.success) {
            // Mark session as failed
            await sql`
                UPDATE sessions SET status = 'expired' WHERE id = ${sessionId}
            `;
            return NextResponse.json(
                { success: false, error: 'Payment failed', details: charge.message },
                { status: 502 }
            );
        }

        // In TEST mode, Paystack doesn't send a real STK push. Instead it
        // returns status "send_otp". We auto-submit the test OTP "123456"
        // so the charge completes and the webhook fires.
        if (isTestMode() && charge.raw.data?.status === 'send_otp') {
            console.log(`[SESSION/START] Test mode detected — auto-submitting OTP "123456"`);
            const otpResult = await submitChargeOTP('123456', charge.reference);
            console.log(`[SESSION/START] Test OTP result: ${otpResult.message}`);
        }

        return NextResponse.json({
            success: true,
            session_id: sessionId,
            amount: FLAT_RATE_KES,
            message: isTestMode()
                ? `TEST MODE: KES ${FLAT_RATE_KES} charge simulated. Webhook will fire shortly.`
                : `KES ${FLAT_RATE_KES}. Check phone to pay.`,
        });

    } catch (error) {
        console.error('[SESSION/START] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
