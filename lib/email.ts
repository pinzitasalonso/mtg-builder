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

/* Shared wrapper so every Spellpool email looks like the others. `cta` is
   optional — a notice with nothing to click doesn't get a button. */
function layout(parts: {
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
}): string {
  const { heading, body, cta, footer } = parts;
  return (
    `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:24px;color:#2a2118">` +
    `<h1 style="font-size:22px;margin:0 0 12px">${heading}</h1>` +
    `<p style="font-size:15px;line-height:1.5">${body}</p>` +
    (cta
      ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#c89b41;color:#1a1407;` +
        `text-decoration:none;padding:12px 22px;border-radius:7px;font-weight:bold">${cta.label}</a></p>`
      : "") +
    (footer ? `<p style="font-size:13px;color:#6b5d4a;line-height:1.5">${footer}</p>` : "") +
    `</div>`
  );
}

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await send({
    to,
    subject: "Verify your email — Spellpool",
    text:
      `Welcome to Spellpool!\n\n` +
      `Confirm your email address by opening this link:\n${url}\n\n` +
      `The link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
    html: layout({
      heading: `Welcome to <span style="color:#b8860b">Spellpool</span>`,
      body: "Confirm your email address to start brewing:",
      cta: { label: "Verify email", url },
      footer:
        "The link expires in 24 hours. If you didn't create an account, you can ignore this email.",
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
      heading: "Your password changed",
      body:
        "The password on your Spellpool account was just changed, and every other " +
        "signed-in device was signed out.",
      cta: { label: "This wasn't me", url: loginUrl },
      footer: "If that was you, there's nothing to do.",
    }),
  });
}
