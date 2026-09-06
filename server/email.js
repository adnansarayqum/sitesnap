// Outbound email: sign-in codes and invitations. Resend's plain HTTP API
// when RESEND_API_KEY is set; otherwise the message is logged, which is
// what a local or pilot deployment without email wants.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "SiteSnap <onboarding@resend.dev>";

export const emailConfigured = !!RESEND_API_KEY;

export async function sendEmail({ to, subject, text, html }) {
  if (!RESEND_API_KEY) {
    console.log(`[email → ${to}] ${subject}\n${text}`);
    return { logged: true };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text, html }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`email failed (${r.status}) ${detail.slice(0, 200)}`);
  }
  return r.json();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function shell(title, body) {
  return `<!doctype html><body style="margin:0;background:#F6F6F3;font:16px/1.5 system-ui,sans-serif;color:#14201B">
<div style="max-width:440px;margin:0 auto;padding:32px 24px">
<div style="font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#5E6B64">SiteSnap</div>
<h1 style="font-size:22px;margin:6px 0 16px">${esc(title)}</h1>${body}
<p style="color:#93A099;font-size:12px;margin-top:28px">If you weren't expecting this, you can ignore it.</p></div></body>`;
}

export function signInCodeEmail(code) {
  const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;
  return {
    subject: `${pretty} is your SiteSnap sign-in code`,
    text: `Your SiteSnap sign-in code is ${pretty}. It works for 10 minutes.`,
    html: shell("Your sign-in code", `<div style="font:800 34px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;background:#fff;border:1px solid #E2E5DF;border-radius:14px;padding:22px;text-align:center">${esc(pretty)}</div><p style="color:#5E6B64">Type it into SiteSnap. It works for 10 minutes.</p>`),
  };
}

export function inviteEmail({ orgName, inviterName, link }) {
  return {
    subject: `${inviterName ? inviterName + " has" : "You've been"} invited you to ${orgName} on SiteSnap`,
    text: `You've been invited to join ${orgName} on SiteSnap. Open this link on your phone to accept: ${link}`,
    html: shell(`Join ${orgName}`, `<p>${esc(inviterName || "An administrator")} has invited you to <strong>${esc(orgName)}</strong> on SiteSnap, the room-by-room inspection photo app.</p><p><a href="${esc(link)}" style="display:inline-block;background:#10352A;color:#fff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 22px">Accept the invitation</a></p><p style="color:#5E6B64;font-size:13px">Open it on the phone you'll inspect with. The link works for 14 days.</p>`),
  };
}
