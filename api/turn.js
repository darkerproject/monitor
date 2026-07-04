// Función serverless (Vercel) — entrega credenciales TURN sin exponer la Secret Key.
// La key vive en la variable de entorno METERED_SECRET_KEY (configurada en Vercel),
// nunca en el código ni en el navegador.
export default async function handler(req, res) {
  // Permite que el navegador (tu app) llame a esta función
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const key = process.env.METERED_SECRET_KEY;
  const domain = process.env.METERED_DOMAIN || "darkermonitor.metered.live";

  if (!key) {
    res.status(500).json({ error: "TURN no configurado (falta METERED_SECRET_KEY)" });
    return;
  }

  try {
    const r = await fetch(
      "https://" + domain + "/api/v1/turn/credentials?apiKey=" + key
    );
    if (!r.ok) {
      res.status(502).json({ error: "Metered respondió " + r.status });
      return;
    }
    const iceServers = await r.json();
    // cache breve en el edge de Vercel; las credenciales de Metered rotan solas
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    res.status(200).json(iceServers);
  } catch (e) {
    res.status(502).json({ error: "No se pudo contactar el servicio TURN" });
  }
}
