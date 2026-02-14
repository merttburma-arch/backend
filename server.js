const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// local geliştirme için .env yükle (Railway'de env zaten panelden gelir)
require("dotenv").config();

const app = express();

// Railway prod ortamında PORT mutlaka process.env.PORT'tan gelir
const PORT = Number(process.env.PORT || 5000);

// Reverse proxy (Railway) arkasında doğru davranması için
app.set("trust proxy", 1);

// ===== ENV =====
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-only";
if (!process.env.JWT_SECRET) {
    console.warn("JWT_SECRET env missing. Development fallback will be used.");
}

// GitHub Pages origin (env ile yönet)
const FRONTEND_ORIGIN =
    process.env.FRONTEND_ORIGIN || "https://merttburma-arch.github.io";

// ===== CORS =====
const allowedOrigins = new Set(["http://localhost:3000", FRONTEND_ORIGIN]);

app.use(
    cors({
        origin: function (origin, cb) {
            if (!origin) return cb(null, true); // curl/postman
            if (allowedOrigins.has(origin)) return cb(null, true);
            return cb(null, false);
        },
        credentials: true,
    })
);

app.use(express.json());

// ===== DATA PATH =====
// Railway’de yazılabilir ve kolay olan: /tmp
const DATA_DIR = process.env.DATA_DIR || "/tmp/eyupogullar-data";
const PRICES_FILE = path.join(DATA_DIR, "prices.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// ===== RESEND (EMAIL) =====
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_TO = process.env.EMAIL_TO || "eyubogullariinsaat@gmail.com";
const EMAIL_FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

// Lazy import (sadece contact gelince kullan)
async function sendMailWithResend({ name, surname, email, message }) {
    if (!RESEND_API_KEY) {
        return { ok: false, status: 503, error: "RESEND_API_KEY tanımlı değil" };
    }

    const { Resend } = await import("resend");
    const resend = new Resend(RESEND_API_KEY);

    // reply_to: kullanıcı maili => Gmail'de "Yanıtla" ile kullanıcıya dönersin
    const subject = `Yeni İletişim Formu Mesajı - ${escapeHtml(name)} ${escapeHtml(
        surname
    )}`;

    const html = `<div>
    <p><b>Ad:</b> ${escapeHtml(name)}</p>
    <p><b>Soyad:</b> ${escapeHtml(surname)}</p>
    <p><b>Email:</b> ${escapeHtml(email)}</p>
    <p><b>Mesaj:</b><br/> ${escapeHtml(message)}</p>
  </div>`;

    try {
        const result = await resend.emails.send({
            from: EMAIL_FROM,
            to: [EMAIL_TO],
            subject,
            html,
            reply_to: email,
        });

        return { ok: true, result };
    } catch (e) {
        return { ok: false, status: 500, error: e?.message || "Resend hata" };
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ===== ensure data files =====
async function ensureDataFiles() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const defaultPrices = {
        basePrices: { p8: 24500, p10: 24200, p12: 23900 },
        districts: [{ name: "Esenyurt", cost: 0 }],
        lastUpdated: new Date().toISOString(),
    };

    const defaultUsers = {
        admin: {
            username: "admin",
            password: bcrypt.hashSync("admin123", 10),
            role: "admin",
        },
    };

    try {
        await fs.access(PRICES_FILE);
    } catch {
        await fs.writeFile(PRICES_FILE, JSON.stringify(defaultPrices, null, 2));
    }

    try {
        await fs.access(USERS_FILE);
    } catch {
        await fs.writeFile(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    }
}

// ===== JWT middleware =====
function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) return res.status(401).json({ error: "Token gerekli" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Geçersiz token" });
        req.user = user;
        next();
    });
}

// ===== routes =====
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

app.get("/", (req, res) => {
    res.json({ message: "Eyüboğulları İnşaat Backend API" });
});

app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const u = (username || "").trim();

        const usersData = await fs.readFile(USERS_FILE, "utf8");
        const users = JSON.parse(usersData);
        const user = users[u];

        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
        }

        const token = jwt.sign({ username: u, role: user.role }, JWT_SECRET, {
            expiresIn: "24h",
        });

        res.json({ token, user: { username: u, role: user.role } });
    } catch (e) {
        res.status(500).json({ error: "Giriş yapılamadı" });
    }
});

app.get("/api/prices", async (req, res) => {
    try {
        const pricesData = await fs.readFile(PRICES_FILE, "utf8");
        res.json(JSON.parse(pricesData));
    } catch (e) {
        res.status(500).json({ error: "Fiyatlar alınamadı" });
    }
});

app.put("/api/prices", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ error: "Yetkisiz erişim" });
        }

        const { basePrices, districts } = req.body;
        if (!basePrices || !districts) {
            return res.status(400).json({ error: "Geçersiz veri" });
        }

        const updatedPrices = {
            basePrices,
            districts,
            lastUpdated: new Date().toISOString(),
        };

        await fs.writeFile(PRICES_FILE, JSON.stringify(updatedPrices, null, 2));
        res.json(updatedPrices);
    } catch (e) {
        res.status(500).json({ error: "Fiyatlar güncellenemedi" });
    }
});

app.post("/api/contact", async (req, res) => {
    try {
        const { name, surname, email, message } = req.body;

        if (!name || !surname || !email || !message) {
            return res.status(400).json({ error: "Tüm alanlar zorunludur" });
        }

        const sent = await sendMailWithResend({ name, surname, email, message });

        if (!sent.ok) {
            return res
                .status(sent.status || 500)
                .json({ error: sent.error || "Mesaj gönderilemedi." });
        }

        res.json({
            success: true,
            message: "Mesajınız başarıyla gönderildi.",
        });
    } catch (e) {
        console.error("Contact hata:", e);
        res.status(500).json({ error: "Mesaj gönderilemedi." });
    }
});

// ===== start + graceful shutdown =====
let server;

async function startServer() {
    await ensureDataFiles();
    server = app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
}

startServer();

process.on("SIGTERM", () => {
    console.log("SIGTERM received. Shutting down gracefully...");
    if (!server) return process.exit(0);

    server.close(() => {
        console.log("Server closed.");
        process.exit(0);
    });

    setTimeout(() => {
        console.log("Force exit.");
        process.exit(1);
    }, 10_000);
});
