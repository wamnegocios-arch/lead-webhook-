// api/webhook.js (CommonJS - Vercel)
const { google } = require("googleapis");

// Normaliza chaves: minúsculas, sem acentos, troca não-alfa-num por "_"
function norm(s = "") {
  return s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string") return xf.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "";
}

function getPrivateKey() {
  if (process.env.GOOGLE_PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }
  return (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

module.exports = async (req, res) => {
  // CORS básico (se for postar do navegador)
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
    // ENVs obrigatórias
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
    const key = getPrivateKey();
    const sheetId = process.env.SHEET_ID || "";
    const sheetTab = process.env.SHEET_TAB || "Leads";
    if (!email) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL ausente.");
    if (!key || !key.includes("BEGIN PRIVATE KEY")) throw new Error("GOOGLE_PRIVATE_KEY ausente/mal formatada.");
    if (!sheetId) throw new Error("SHEET_ID ausente.");

    // Corpo (aceita JSON ou x-www-form-urlencoded)
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    if (!body || typeof body !== "object") body = {};

    // Cria dicionário normalizado do body (suporta snake e camel)
    const flat = {};
    for (const [k, v] of Object.entries(body)) flat[norm(k)] = v;

    // Sinônimos úteis (GreatPages costuma mandar camelCase)
    const aliases = {
      e_mail: "email",
      ip_do_usuario: "ip_usuario",
      ip_usuario: "ip_usuario",
      ipusuario: "ip_usuario",
      politicas_de_privacidade: "politicas_privacidade",
      politicasprivacidade: "politicas_privacidade",
      referral_source: "referral_source",
      referralsource: "referral_source",
      data_de_conversao: "data_conversao",
      dataconversao: "data_conversao",
      id_do_formulario: "id_formulario",
      idformulario: "id_formulario",
      pais_do_usuario: "pais_usuario",
      paisusuario: "pais_usuario",
      regiao_do_usuario: "regiao_usuario",
      regiaousuario: "regiao_usuario",
      cidade_do_usuario: "cidade_usuario",
      cidadeusuario: "cidade_usuario",
      id_da_pagina: "id_pagina",
      idpagina: "id_pagina"
    };
    for (const [k, target] of Object.entries(aliases)) {
      if (flat[k] != null && flat[target] == null) flat[target] = flat[k];
    }

    // Preencher automáticos/backup
    if (!flat["ip_usuario"]) flat["ip_usuario"] = getIp(req);
    if (!flat["data_conversao"]) flat["data_conversao"] = new Date().toISOString();

    // Autentica
    const auth = new google.auth.JWT(
      email,
      undefined,
      key,
      ["https://www.googleapis.com/auth/spreadsheets"]
    );
    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    // Lê cabeçalhos (linha 1) da aba alvo
    const headResp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetTab}!1:1`
    });
    const headers = (headResp.data.values && headResp.data.values[0]) || [];

    // Monta a linha na MESMA ORDEM dos cabeçalhos
    const row = headers.map((h) => {
      const key = norm(h); // ex.: "E-mail" -> "e_mail"
      return flat[key] != null ? flat[key] : "";
    });

    // Se a planilha estiver vazia (sem cabeçalhos), fallback para ordem "oficial"
    if (headers.length === 0) {
      const fallbackOrder = [
        "nome","email","whatsapp","politicas_privacidade","referral_source","dispositivo",
        "url","ip_usuario","data_conversao","id_formulario","pais_usuario","regiao_usuario",
        "cidade_usuario","id_pagina"
      ];
      row.length = 0;
      for (const k of fallbackOrder) row.push(flat[k] ?? "");
    }

    // Append com USER_ENTERED para respeitar formatação da planilha
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${sheetTab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] }
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Internal error" });
  }
};
