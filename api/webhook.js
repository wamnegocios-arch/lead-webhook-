// api/webhook.js (CommonJS)
const { google } = require("googleapis");

function getIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string") return xf.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "";
}

module.exports = async (req, res) => {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // (Opcional) token simples
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    if (!body || typeof body !== "object") body = {};

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
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : "Internal error" });
  }
};
