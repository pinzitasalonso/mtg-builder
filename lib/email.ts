// Outbound email via Resend's REST API — plain fetch, no SDK. Server-only.
// Without RESEND_API_KEY (local dev) the message is logged to the server
// console instead so the flow stays testable.

const RESEND_URL = "https://api.resend.com/emails";

// Resend's shared onboarding sender works out of the box but only delivers
// to the Resend account owner's address; verify a domain to email others.
// Read per-send rather than captured at import, so it behaves the same way
// emailConfigured() does.
const from = () => process.env.EMAIL_FROM ?? "Spellpool <onboarding@resend.dev>";

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/* The one place that talks to Resend. Throws on a non-2xx so callers can
   decide whether a failed send is fatal (signup reports it) or ignorable
   (resend swallows it). */
async function send({ to, subject, text, html }: Message): Promise<void> {
  if (!emailConfigured()) {
    console.log(`[email] RESEND_API_KEY not set — "${subject}" for ${to}:\n${text}`);
    return;
  }
  const res = await fetch(RESEND_URL, {
    method: "POST",
    // A slow Resend mustn't hold a sign-up or a reset request open for minutes.
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: from(), to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}

/* Shared wrapper so every Spellpool email looks like the others: the site's
   light theme (warm off-white ground, a white card, the blue drop mark, the
   electric-blue button). Email clients ignore <style> blocks and flexbox, so
   it is tables and inline styles only. The button is a table cell, so it
   keeps its colour in Outlook. `cta` is optional — a notice with nothing to
   click doesn't get a button; when there is one, the bare link follows it
   for clients that block buttons. `preheader` is the grey preview line an
   inbox shows next to the subject. */
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#141210";
const MUTED = "#57534e";
const FAINT = "#8a847c";
const ACCENT = "#1201ff";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The links point at the site that sent them, so the logo comes from there too.
function siteOrigin(url: string | undefined): string {
  try {
    if (url) return new URL(url).origin;
  } catch {}
  return (process.env.APP_URL ?? "https://www.spellpool.com").replace(/\/+$/, "");
}

function layout(parts: {
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
}): string {
  const { preheader, heading, body, cta, footer } = parts;
  const origin = siteOrigin(cta?.url);
  const href = cta ? escapeHtml(cta.url) : "";
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `</head><body style="margin:0;padding:0;background:#f7f6f3">` +
    // The inbox preview line, hidden in the message itself.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f6f3">` +
    `<tr><td align="center" style="padding:40px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">` +
    // Logo
    `<tr><td style="padding:0 4px 20px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="vertical-align:middle;padding-right:10px">` +
    `<img src="${origin}/email/mark.png" width="32" height="32" alt="" style="display:block;border:0;width:32px;height:32px"></td>` +
    `<td style="vertical-align:middle;font-family:${FONT};font-size:19px;font-weight:700;letter-spacing:-0.02em;color:${INK}">Spellpool</td>` +
    `</tr></table></td></tr>` +
    // Card
    `<tr><td style="background:#ffffff;border:1px solid #e8e5df;border-radius:20px;padding:36px 32px">` +
    `<h1 style="margin:0 0 14px;font-family:${FONT};font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-0.025em;color:${INK}">${heading}</h1>` +
    `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:${MUTED}">${body}</p>` +
    (cta
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0"><tr>` +
        `<td align="center" bgcolor="${ACCENT}" style="border-radius:999px;background:${ACCENT}">` +
        `<a href="${href}" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;` +
        `color:#ffffff;text-decoration:none;border-radius:999px">${cta.label}</a></td></tr></table>` +
        `<p style="margin:24px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${FAINT}">` +
        `Button not working? Paste this link into your browser:<br>` +
        `<a href="${href}" style="color:${ACCENT};word-break:break-all">${href}</a></p>`
      : "") +
    `</td></tr>` +
    // Footer
    `<tr><td style="padding:22px 4px 0;font-family:${FONT};font-size:13px;line-height:1.55;color:${FAINT}">` +
    (footer ? `${footer}<br><br>` : "") +
    `Spellpool · <a href="${origin}" style="color:${FAINT};text-decoration:underline">${origin.replace(/^https?:\/\//, "")}</a>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await send({
    to,
    subject: "Confirm your email — Spellpool",
    text:
      `Welcome to Spellpool!\n\n` +
      `Confirm your email address by opening this link. It signs you in too:\n${url}\n\n` +
      `The link works for 24 hours. If you didn't sign up for Spellpool, you can ignore this email.`,
    html: layout({
      preheader: "One tap to confirm your email and start brewing.",
      heading: "Confirm your email",
      body:
        "Welcome to Spellpool! Tap the button to confirm your email address. " +
        "It signs you in too, so you can start brewing right away.",
      cta: { label: "Confirm my email", url },
      footer: "The link works for 24 hours. If you didn't sign up for Spellpool, you can ignore this email.",
    }),
  });
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  await send({
    to,
    subject: "Reset your password — Spellpool",
    text:
      `Someone asked to reset the password for your Spellpool account.\n\n` +
      `Choose a new one here:\n${url}\n\n` +
      `The link expires in an hour and works once. If this wasn't you, ignore this ` +
      `email — your password stays as it is.`,
    html: layout({
      preheader: "Choose a new password for your Spellpool account.",
      heading: "Reset your password",
      body: "Someone asked to reset the password for your Spellpool account.",
      cta: { label: "Choose a new password", url },
      footer:
        "The link expires in an hour and works once. If this wasn't you, ignore this " +
        "email — your password stays as it is.",
    }),
  });
}

/* Sent when someone tries to sign up with an address that already has a
   verified account. Signup answers "check your inbox" either way — the
   enumeration fix — so this is what actually arrives, and it has to be
   useful to a person who genuinely forgot they had an account. */
export async function sendAccountExistsEmail(to: string, loginUrl: string): Promise<void> {
  await send({
    to,
    subject: "You already have a Spellpool account",
    text:
      `Someone tried to create a Spellpool account with this address, but you ` +
      `already have one.\n\nSign in here:\n${loginUrl}\n\n` +
      `Forgot your password? Use the "Forgot password?" link on that page. ` +
      `If this wasn't you, nothing has changed on your account.`,
    html: layout({
      preheader: "Sign in with the account you already have.",
      heading: "You already have an account",
      body: "Someone tried to create a Spellpool account with this address — you already have one.",
      cta: { label: "Sign in", url: loginUrl },
      footer:
        'Forgot your password? Use the "Forgot password?" link on that page. ' +
        "If this wasn't you, nothing has changed on your account.",
    }),
  });
}

/* A password just changed. Not actionable, but it is the only signal a user
   gets that someone else got in. */
export async function sendPasswordChangedEmail(to: string, loginUrl: string): Promise<void> {
  await send({
    to,
    subject: "Your Spellpool password changed",
    text:
      `The password on your Spellpool account was just changed, and every other ` +
      `signed-in device was signed out.\n\n` +
      `If that was you, there's nothing to do. If it wasn't, reset your password ` +
      `now:\n${loginUrl}`,
    html: layout({
      preheader: "The password on your Spellpool account was just changed.",
      heading: "Your password changed",
      body:
        "The password on your Spellpool account was just changed, and every other " +
        "signed-in device was signed out.",
      cta: { label: "This wasn't me", url: loginUrl },
      footer: "If that was you, there's nothing to do.",
    }),
  });
}
