// Outbound email via Resend's REST API — plain fetch, no SDK. Server-only.
// Without RESEND_API_KEY (local dev) the message is logged to the server
// console instead so the flow stays testable.

const RESEND_URL = "https://api.resend.com/emails";

// Resend's shared onboarding sender works out of the box but only delivers
// to the Resend account owner's address; verify a domain to email others.
const FROM = process.env.EMAIL_FROM ?? "Spellpool <onboarding@resend.dev>";

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  if (!emailConfigured()) {
    console.log(`[email] RESEND_API_KEY not set — verification link for ${to}:\n${url}`);
    return;
  }
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: "Verify your email — Spellpool",
      text:
        `Welcome to Spellpool!\n\n` +
        `Confirm your email address by opening this link:\n${url}\n\n` +
        `The link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
      html:
        `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:24px;color:#2a2118">` +
        `<h1 style="font-size:22px;margin:0 0 12px">Welcome to <span style="color:#b8860b">Spellpool</span></h1>` +
        `<p style="font-size:15px;line-height:1.5">Confirm your email address to start brewing:</p>` +
        `<p style="margin:24px 0"><a href="${url}" style="background:#c89b41;color:#1a1407;text-decoration:none;` +
        `padding:12px 22px;border-radius:7px;font-weight:bold">Verify email</a></p>` +
        `<p style="font-size:13px;color:#6b5d4a;line-height:1.5">The link expires in 24 hours. ` +
        `If you didn't create an account, you can ignore this email.</p>` +
        `</div>`,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${text.slice(0, 300)}`);
  }
}
