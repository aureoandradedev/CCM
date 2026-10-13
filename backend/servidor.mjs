/**
 * Backend da Multigiro Central de Compras.
 *
 *   /api/status                     saúde e configuração (sem segredos)
 *   /api/pagamentos/...             criar-pedido, pix, cartao, webhook, estorno
 *   /api/imagens/...                fotos de produto via QRofertas + Storage
 *
 * Roda na VPS (ou localmente): `npm start`. Config em backend/.env.
 */
import cors from "cors";
import express from "express";
import helmet from "helmet";

import { config, supabaseConfigurado } from "./lib/config.mjs";
import { imagens } from "./routes/imagens.mjs";
import { pagamentos } from "./routes/pagamentos.mjs";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: process.env.NODE_ENV === "production",
  }),
);
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  next();
});

// CORS: origens da loja + localhost (dev). Requisição sem Origin (webhook, curl) passa.
const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || localhost.test(origin) || config.storeOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false })); // webhook da Cielo pode vir urlencoded

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    supabase: supabaseConfigurado(),
    cielo: config.cieloConfigurado,
    pagamentoMock: config.pagamentoMock,
    qrofertas: config.qrofertasConfigurado,
    hora: new Date().toISOString(),
  });
});

app.use("/api/pagamentos", pagamentos);
app.use("/api/imagens", imagens);

app.use((_req, res) => res.status(404).json({ ok: false, erro: "rota não encontrada" }));
app.use((err, _req, res, next) => {
  void next; // assinatura de 4 argumentos = handler de erro do Express
  console.error("[erro]", err?.message || err);
  res.status(500).json({ ok: false, erro: "Erro interno." });
});

app.listen(config.porta, () => {
  console.log(`✅ backend CCM na porta ${config.porta} | supabase=${supabaseConfigurado()} cielo=${config.cieloConfigurado} mock=${config.pagamentoMock} qrofertas=${config.qrofertasConfigurado}`);
});
