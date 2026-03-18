type VerificationTemplateInput = {
  fullName: string;
  verificationUrl: string;
  appName: string;
};

type AccountActivationTemplateInput = {
  fullName: string;
  activationUrl: string;
  appName: string;
};

type PasswordResetTemplateInput = {
  fullName: string;
  resetUrl: string;
  appName: string;
};

export function buildVerificationEmailTemplate(input: VerificationTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { fullName, verificationUrl, appName } = input;
  const subject = `${appName}: verifica tu correo`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
      <h2 style="margin-bottom: 8px;">Hola ${escapeHtml(fullName)},</h2>
      <p>Gracias por registrarte en ${escapeHtml(appName)}.</p>
      <p>Confirma tu correo haciendo clic en este boton:</p>
      <p>
        <a href="${escapeHtml(verificationUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#0ea5e9;color:#fff;text-decoration:none;">
          Verificar correo
        </a>
      </p>
      <p>Si el boton no funciona, usa este enlace:</p>
      <p><a href="${escapeHtml(verificationUrl)}">${escapeHtml(verificationUrl)}</a></p>
    </div>
  `.trim();
  const text = [
    `Hola ${fullName},`,
    ``,
    `Gracias por registrarte en ${appName}.`,
    `Verifica tu correo en este enlace:`,
    verificationUrl,
  ].join('\n');

  return { subject, html, text };
}

export function buildAccountActivationEmailTemplate(input: AccountActivationTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { fullName, activationUrl, appName } = input;
  const subject = `${appName}: activa tu cuenta de administrador`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
      <h2 style="margin-bottom: 8px;">Hola ${escapeHtml(fullName)},</h2>
      <p>Tu cuenta administrativa fue creada en ${escapeHtml(appName)}.</p>
      <p>Para activarla, confirma tu correo y define tu contrasena desde este enlace:</p>
      <p>
        <a href="${escapeHtml(activationUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#0ea5e9;color:#fff;text-decoration:none;">
          Activar cuenta
        </a>
      </p>
      <p>Enlace directo: <a href="${escapeHtml(activationUrl)}">${escapeHtml(activationUrl)}</a></p>
    </div>
  `.trim();
  const text = [
    `Hola ${fullName},`,
    ``,
    `Tu cuenta administrativa fue creada en ${appName}.`,
    `Activa tu cuenta y define tu contrasena aqui:`,
    activationUrl,
  ].join('\n');

  return { subject, html, text };
}

export function buildPasswordResetEmailTemplate(input: PasswordResetTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { fullName, resetUrl, appName } = input;
  const subject = `${appName}: restablece tu contrasena`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
      <h2 style="margin-bottom: 8px;">Hola ${escapeHtml(fullName)},</h2>
      <p>Recibimos una solicitud para restablecer tu contrasena en ${escapeHtml(appName)}.</p>
      <p>Haz clic en este boton para continuar:</p>
      <p>
        <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#f59e0b;color:#111;text-decoration:none;">
          Restablecer contrasena
        </a>
      </p>
      <p>Si no solicitaste este cambio, ignora este correo.</p>
      <p>Enlace directo: <a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
    </div>
  `.trim();
  const text = [
    `Hola ${fullName},`,
    ``,
    `Recibimos una solicitud para restablecer tu contrasena en ${appName}.`,
    `Usa este enlace para continuar:`,
    resetUrl,
    ``,
    `Si no solicitaste este cambio, ignora este correo.`,
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
