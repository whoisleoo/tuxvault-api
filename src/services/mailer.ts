import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { randomInt } from 'crypto';
import { createHash } from 'crypto';




const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false, 
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
})

export async function sendOtp(username : string){
  const otp = randomInt(100000, 999999).toString();

  const mailOptions = {
    from: env.SMTP_USER,
    to: env.SMTP_TO,
    subject: 'Tux Vault OTP',
    text: `Seu código de verificação é ${otp}`,
    html: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>TUX VAULT — OTP</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Courier New',monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:48px 24px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color:#111111;border:1px solid #333333;">
          <tr>
            <td style="padding:28px 40px;border-bottom:1px solid #333333;">
              <p style="margin:0;color:#ffffff;font-size:12px;letter-spacing:6px;text-transform:uppercase;">TUX VAULT</p>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 40px 28px;">
              <p style="margin:0 0 10px;color:#888888;font-size:10px;letter-spacing:3px;text-transform:uppercase;">Tentativa de acesso detectada</p>
              <p style="margin:0;color:#ffffff;font-size:18px;line-height:1.6;">
                O usuário <strong style="color:#ffffff;">${username}</strong> está solicitando entrada no sistema.
              </p>
            </td>
          </tr>

        
          <tr>
            <td style="padding:0 40px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
                <tr>
                  <td style="padding:28px 32px;">
                    <p style="margin:0 0 10px;color:#555555;font-size:9px;letter-spacing:4px;text-transform:uppercase;">Código de verificação</p>
                    <p style="margin:0;color:#000000;font-size:44px;letter-spacing:18px;font-weight:bold;">${otp}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

    
          <tr>
            <td style="padding:0 40px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #333333;">
                <tr>
                  <td style="padding:14px 20px;">
                    <p style="margin:0;color:#888888;font-size:10px;letter-spacing:2px;line-height:1.8;">
                      ⚠ &nbsp;Este código expira em <strong style="color:#ffffff;">5 minutos</strong>.<br/>
                      Se você não reconhece esta tentativa, ignore este email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid #333333;">
              <p style="margin:0;color:#555555;font-size:9px;letter-spacing:3px;text-transform:uppercase;">Made by @whoisleoo</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  }

  try{
    await transporter.sendMail(mailOptions); 
    return createHash('sha256').update(otp).digest('hex');
  }catch(err){
    throw Error("Ocorreu um erro ao tentar enviar o email.");
  }
  
}