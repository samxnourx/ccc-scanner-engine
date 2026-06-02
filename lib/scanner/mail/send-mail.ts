import "server-only";

import path from "node:path";

import nodemailer from "nodemailer";

type SendMailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  profile?: "default" | "outreach";
};

type SendMailResult = {
  messageId: string | null;
};

function envForProfile(profile: SendMailInput["profile"], key: string): string | undefined {
  if (profile === "outreach") {
    const outreachValue = process.env[`OUTREACH_${key}`]?.trim();
    if (outreachValue) return outreachValue;
  }
  return process.env[key]?.trim();
}

function smtpPort(profile: SendMailInput["profile"]): number {
  const raw = Number.parseInt(envForProfile(profile, "SMTP_PORT") || "587", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 587;
}

export async function sendPlainTextMail(input: SendMailInput): Promise<SendMailResult> {
  const profile = input.profile ?? "default";
  const host = envForProfile(profile, "SMTP_HOST");
  const user = envForProfile(profile, "SMTP_USER");
  const pass = envForProfile(profile, "SMTP_PASS") ?? "";
  const from = envForProfile(profile, "SMTP_FROM") || user;
  const port = smtpPort(profile);

  if (!host || !user || !pass || !from) {
    throw new Error(`${profile === "outreach" ? "Outreach SMTP" : "SMTP"} settings are incomplete.`);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.html?.includes("cid:ccc-email-logo")
      ? [
          {
            filename: "california-claims-center-logo-light.png",
            path: path.join(
              process.cwd(),
              "assets",
              "email",
              "california-claims-center-logo-light.png",
            ),
            cid: "ccc-email-logo-light",
          },
          {
            filename: "california-claims-center-logo-dark.png",
            path: path.join(
              process.cwd(),
              "assets",
              "email",
              "california-claims-center-logo-dark.png",
            ),
            cid: "ccc-email-logo-dark",
          },
        ]
      : undefined,
  });

  return {
    messageId:
      typeof info.messageId === "string" && info.messageId.trim()
        ? info.messageId.trim()
        : null,
  };
}
