import nodemailer from 'nodemailer';
import { env } from '../config/env.js';





const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false, 
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
})

export async function sendOtp(username: string, otp: string, pendingId: string, approveToken: string, userIp: string) {
  const approveUrl = `${env.APP_URL}/api/auth/approve/${pendingId}?token=${approveToken}`;
  const escapeHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');


  const mailOptions = {
    from: env.SMTP_USER,
    to: env.SMTP_TO,
    subject: 'Tux Vault OTP',
    text: `Usuário ${escapeHtml(username)} está tentando logar. Código: ${otp}. Aprovar: ${approveUrl}`,
    html: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>TUX VAULT — Acesso</title>
</head>
<body style="margin:0;padding:0;background-color:#080808;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 24px;background-color:#080808;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0">

          <!-- Header -->
          <tr>
            <td style="padding:0 0 32px;">
              <p style="margin:0;color:#ffffff;font-size:11px;letter-spacing:8px;text-transform:uppercase;font-weight:bold;">TUX VAULT</p>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#111111;border:1px solid #222222;padding:40px;">

              <!-- Title -->
              <p style="margin:0 0 6px;color:#666666;font-size:10px;letter-spacing:4px;text-transform:uppercase;">Tentativa de acesso</p>
              <p style="margin:0 0 32px;color:#ffffff;font-size:20px;font-weight:bold;line-height:1.4;">
                ${escapeHtml(username)}
              </p>
              <p style="margin:0 0 6px;color:#666666;font-size:10px;letter-spacing:4px;text-transform:uppercase;">IP do usuário</p>
              <p style="margin:0 0 32px;color:#ffffff;font-size:20px;font-weight:bold;line-height:1.4;">
                ${escapeHtml(userIp)}
              </p>

              <!-- Divider -->
              <div style="height:1px;background-color:#222222;margin:0 0 32px;"></div>

              <!-- OTP -->
              <p style="margin:0 0 12px;color:#666666;font-size:10px;letter-spacing:4px;text-transform:uppercase;">Código de verificação</p>
              <p style="margin:0 0 32px;color:#ffffff;font-size:48px;font-weight:bold;letter-spacing:12px;">${otp}</p>

              <!-- Approve Button -->
              <a href="${approveUrl}" style="display:inline-block;background-color:#ffffff;color:#000000;text-decoration:none;font-size:11px;font-weight:bold;letter-spacing:4px;text-transform:uppercase;padding:14px 32px;">
                APROVAR ACESSO
              </a>

              <!-- Divider -->
              <div style="height:1px;background-color:#222222;margin:32px 0;"></div>

              <!-- Warning -->
              <p style="margin:0;color:#555555;font-size:12px;line-height:1.7;">
                Expira em <span style="color:#ffffff;">5 minutos</span>. Se não reconhece esta tentativa, ignore este email.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0;">
              <p style="margin:0;color:#333333;font-size:10px;letter-spacing:3px;text-transform:uppercase;">Made by @whoisleoo</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`,
  }

  try{
    await transporter.sendMail(mailOptions);
  }catch(err){
    throw Error("Ocorreu um erro ao tentar enviar o email.");
  }
}