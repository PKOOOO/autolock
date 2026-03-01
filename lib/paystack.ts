// =============================================================
// lib/paystack.ts — Paystack M-Pesa STK Push Helper
// =============================================================
//
// Paystack Charge API for Mobile Money (M-Pesa Kenya):
//   POST https://api.paystack.co/charge
//   Body: { email, amount (kobo), mobile_money: { phone, provider: "mpesa" } }
//
// Paystack amounts are in the smallest currency unit:
//   KES 10 = 1000 (kobo equivalent for KES)
//
// Since M-Pesa only needs a phone number but Paystack requires email,
// we generate a placeholder: "254722000000@autolock.local"
//
// =============================================================

import crypto from 'crypto';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// -------------------------------------------------------------
// getSecretKey()
// Returns the Paystack secret key from environment variables.
// Throws if not configured.
// -------------------------------------------------------------
function getSecretKey(): string {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) {
        throw new Error('[PAYSTACK] PAYSTACK_SECRET_KEY is not set. Check .env');
    }
    return key;
}

// -------------------------------------------------------------
// formatPhone()
// Normalizes Kenyan phone numbers to Paystack M-Pesa format.
// Paystack REQUIRES the '+' prefix for M-Pesa.
//   "0741535521"    → "+254741535521"
//   "+254741535521"  → "+254741535521"
//   "254741535521"   → "+254741535521"
// -------------------------------------------------------------
function formatPhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-]/g, '');

    if (cleaned.startsWith('+254')) {
        return cleaned; // Already correct
    } else if (cleaned.startsWith('254')) {
        return '+' + cleaned;
    } else if (cleaned.startsWith('0')) {
        return '+254' + cleaned.slice(1);
    }

    // Fallback: assume it's a local number without leading 0
    return '+254' + cleaned;
}

// -------------------------------------------------------------
// phoneToEmail()
// Generates a placeholder email from a phone number.
// Paystack requires email on every charge, but M-Pesa users
// only have phone numbers.
// -------------------------------------------------------------
function phoneToEmail(phone: string): string {
    const digits = formatPhone(phone).replace('+', '');
    return `${digits}@autolock-storage.com`;
}

// -------------------------------------------------------------
// Types
// -------------------------------------------------------------
interface PaystackChargeResponse {
    status: boolean;
    message: string;
    data: {
        reference: string;
        status: string;
        display_text?: string;
        [key: string]: unknown;
    };
}

interface ChargeResult {
    success: boolean;
    reference: string;
    message: string;
    raw: PaystackChargeResponse;
}

// -------------------------------------------------------------
// initiateMpesaCharge()
// Sends an M-Pesa STK push to the user's phone via Paystack.
//
// Parameters:
//   phone       — Kenyan phone number (any format)
//   amountKES   — Amount in KES (e.g. 10 for KES 10)
//   reference   — Unique transaction reference
//
// Returns:
//   { success, reference, message, raw }
// -------------------------------------------------------------
export async function initiateMpesaCharge(
    phone: string,
    amountKES: number,
    reference: string
): Promise<ChargeResult> {
    const formattedPhone = formatPhone(phone);
    const email = phoneToEmail(phone);
    const amountInSubunit = amountKES * 100; // KES to smallest unit

    console.log(`[PAYSTACK] Initiating M-Pesa charge:`);
    console.log(`  Phone: ${formattedPhone}`);
    console.log(`  Amount: KES ${amountKES} (${amountInSubunit} subunits)`);
    console.log(`  Reference: ${reference}`);

    const requestBody = {
        email,
        amount: amountInSubunit,
        currency: 'KES',
        reference,
        mobile_money: {
            phone: formattedPhone,
            provider: 'mpesa',
        },
        metadata: {
            custom_fields: [
                {
                    display_name: 'Service',
                    variable_name: 'service',
                    value: 'AutoLock Storage',
                },
            ],
        },
    };

    console.log(`[PAYSTACK] Request body:`, JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${PAYSTACK_BASE_URL}/charge`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getSecretKey()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    const data: PaystackChargeResponse = await response.json();

    console.log(`[PAYSTACK] Full response:`, JSON.stringify(data, null, 2));

    // M-Pesa charges return status:false with message:"Charge attempted"
    // when the STK push is pending user confirmation. This is NOT an error.
    const isPending = data.message === 'Charge attempted' ||
        data.data?.status === 'send_otp' ||
        data.data?.status === 'pay_offline' ||
        data.data?.status === 'pending';

    return {
        success: data.status || isPending,
        reference: data.data?.reference || reference,
        message: data.message,
        raw: data,
    };
}

// -------------------------------------------------------------
// verifyWebhookSignature()
// Validates that a webhook request actually came from Paystack.
// Uses HMAC SHA-512 with your secret key.
//
// Parameters:
//   body      — Raw request body as string
//   signature — Value of 'x-paystack-signature' header
//
// Returns: true if signature is valid
// -------------------------------------------------------------
export function verifyWebhookSignature(
    body: string,
    signature: string
): boolean {
    const hash = crypto
        .createHmac('sha512', getSecretKey())
        .update(body)
        .digest('hex');

    return hash === signature;
}

// -------------------------------------------------------------
// generateOTP()
// Generates a random 4-digit OTP string.
// Uses crypto.randomInt for cryptographic randomness.
// -------------------------------------------------------------
export function generateOTP(): string {
    const otp = crypto.randomInt(1000, 10000).toString();
    return otp;
}

// -------------------------------------------------------------
// hashOTP()
// Creates a SHA-256 hash of the OTP for secure storage.
// The plain OTP is stored temporarily for ESP32 delivery,
// but the hash remains as a permanent audit record.
// -------------------------------------------------------------
export function hashOTP(otp: string): string {
    return crypto
        .createHash('sha256')
        .update(otp + (process.env.NEXTAUTH_SECRET || ''))
        .digest('hex');
}

// -------------------------------------------------------------
// isTestMode()
// Returns true if using Paystack test keys.
// Test keys start with "sk_test_".
// -------------------------------------------------------------
export function isTestMode(): boolean {
    return getSecretKey().startsWith('sk_test_');
}

// -------------------------------------------------------------
// submitChargeOTP()
// Submits an OTP to complete a Paystack charge.
//
// In TEST mode, Paystack mobile money returns status "send_otp"
// instead of sending a real STK push. You must call this with
// OTP "123456" to simulate the user approving payment.
//
// In LIVE mode, the real STK push goes to the phone and
// this function is not needed.
// -------------------------------------------------------------
export async function submitChargeOTP(
    otp: string,
    reference: string
): Promise<ChargeResult> {
    console.log(`[PAYSTACK] Submitting OTP for ref: ${reference}`);

    const response = await fetch(`${PAYSTACK_BASE_URL}/charge/submit_otp`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getSecretKey()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ otp, reference }),
    });

    const data: PaystackChargeResponse = await response.json();
    console.log(`[PAYSTACK] OTP submit response:`, JSON.stringify(data, null, 2));

    return {
        success: data.status || data.data?.status === 'success',
        reference: data.data?.reference || reference,
        message: data.message,
        raw: data,
    };
}

// Re-export formatPhone for use in API routes
export { formatPhone };
