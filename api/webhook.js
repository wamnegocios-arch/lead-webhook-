import { google } from "googleapis";

function getIp(req) {
  // tenta capturar IP se não vier no body
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string") return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

export default async function handler(req, res) {
  // CORS básico (se for postar direto do navegador)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // (Opcional) proteção por token simples
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // body pode vir como objeto (JSON) ou string
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    if (!body || typeof body !== "object") body = {};

    // Mapeie os campos para a ORDEM da sua planilha:
    // 1 Nome | 2 E-mail | 3 WhatsApp | 4 Políticas de privacidade | 5 Referral source
    // 6 Dispositivo | 7 URL | 8 IP do Usuario | 9 Data de conversão | 10 Id do formulário
    // 11 País do Usuário | 12 Região do Usuário | 13 Cidade do Usuário | 14 Id da página
    const ipHeader = getIp(req);
    const row = [
      body.nome ?? "",
      body.email ?? body["e-mail"] ?? "",
      body.whatsapp ?? "",
      body.politicas_privacidade ?? body.politicasPrivacidade ?? "",
      body.referral_source ?? body.referralSource ?? "",
      body.dispositivo ?? "",
      body.url ?? "",
      body.ip_usuario ?? body.ipUsuario ?? ipHeader ?? "",
      body.data_conversao ?? body.dataConversao ?? new Date().toISOString(),
      body.id_formulario ?? body.idFormulario ?? "",
      body.pais_usuario ?? body.paisUsuario ?? "",
      body.regiao_usuario ?? body.regiaoUsuario ?? "",
      body.cidade_usuario ?? body.cidadeUsuario ?? "",
      body.id_pagina ?? body.idPagina ?? ""
    ];

    // Autenticação com Service Account (env vars)
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      undefined,
      (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/spreadsheets"]
    );
    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_TAB || "Leads"}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Internal error" });
  }
}
