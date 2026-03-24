// =============================================================
// lib/sms.ts — Africa's Talking SMS Helper
// =============================================================
//
// Sends SMS via Africa's Talking REST API.
// No npm package needed — just a simple fetch call.
//
// Sandbox mode: username = "sandbox", messages are free
// Live mode:    username = your AT username, messages cost ~KES 0.5
//
// Required .env:
//   AFRICASTALKING_USERNAME=sandbox
//   AFRICASTALKING_SECRET_KEY=atsk_xxxxx
//
// =============================================================

const AT_SMS_URL = 'https://api.sandbox.africastalking.com/version1/messaging';
const AT_LIVE_URL = 'https://api.africastalking.com/version1/messaging';

function getATConfig() {
    const username = process.env.AFRICASTALKING_USERNAME;
    const apiKey = process.env.AFRICASTALKING_SECRET_KEY;

    if (!username || !apiKey) {
        throw new Error('[SMS] AFRICASTALKING_USERNAME or AFRICASTALKING_SECRET_KEY not set');
    }

    return { username, apiKey };
}

function isSandbox(): boolean {
    return (process.env.AFRICASTALKING_USERNAME || '').toLowerCase() === 'sandbox';
}

// -------------------------------------------------------------
// formatPhoneForAT()
// Africa's Talking requires +254 format for Kenyan numbers.
// -------------------------------------------------------------
function formatPhoneForAT(phone: string): string {
    let cleaned = phone.replace(/[\s\-]/g, '');

    if (cleaned.startsWith('+254')) return cleaned;
    if (cleaned.startsWith('254')) return '+' + cleaned;
    if (cleaned.startsWith('0')) return '+254' + cleaned.slice(1);

    return '+254' + cleaned;
}

// -------------------------------------------------------------
// sendPinSMS()
// Sends the 4-digit PIN to the customer via SMS.
// Returns { success, message }
// -------------------------------------------------------------
export async function sendPinSMS(
    phone: string,
    pin: string
): Promise<{ success: boolean; message: string }> {
    try {
        const { username, apiKey } = getATConfig();
        const to = formatPhoneForAT(phone);
        const smsMessage = `Your AutoLock PIN is: ${pin}. Use this code to retrieve your items.`;

        const url = isSandbox() ? AT_SMS_URL : AT_LIVE_URL;

        console.log(`[SMS] Sending PIN to ${to} (${isSandbox() ? 'SANDBOX' : 'LIVE'})`);

        const params = new URLSearchParams();
        params.append('username', username);
        params.append('to', to);
        params.append('message', smsMessage);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'apiKey': apiKey,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
            body: params.toString(),
        });

        const responseText = await response.text();
        console.log(`[SMS] Status: ${response.status}, Response: ${responseText}`);

        // AT returns plain text errors (e.g. "The supplied API key does not exist")
        if (!response.ok || !responseText.startsWith('{')) {
            return {
                success: false,
                message: `AT error (${response.status}): ${responseText}`,
            };
        }

        const data = JSON.parse(responseText);

        // AT returns { SMSMessageData: { Recipients: [...] } }
        const recipients = data?.SMSMessageData?.Recipients;
        if (recipients && recipients.length > 0) {
            const status = recipients[0].status;
            const success = status === 'Success' || status === 'Sent';
            return {
                success,
                message: `SMS ${status} to ${to}`,
            };
        }

        return {
            success: false,
            message: data?.SMSMessageData?.Message || 'Unknown error',
        };

    } catch (error) {
        console.error('[SMS] Error:', error);
        return {
            success: false,
            message: String(error),
        };
    }
}
