// server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Resend (npm i resend)
const { Resend } = require("resend");

require("dotenv").config();

const app = express();

// Railway prod ortamında PORT mutlaka process.env.PORT’tan gelir
const PORT = Number(process.env.PORT || 5000);

// Reverse proxy arkasında doğru davranması için
app.set("trust proxy", 1);

// ===== ENV =====
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-only";
if (!process.env.JWT_SECRET) {
    console.warn("JWT_SECRET env missing. Development fallback will be used.");
}

// Frontend origin (GitHub Pages)
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
const DATA_DIR = process.env.DATA_DIR || "/tmp/eyupogullar-data";
const PRICES_FILE = path.join(DATA_DIR, "prices.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// ===== Resend =====
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Eyüboğulları <onboarding@resend.dev>";
const EMAIL_TO = process.env.EMAIL_TO || "eyubogullariinsaat@gmail.com";

let resend = null;
if (RESEND_API_KEY) {
    resend = new Resend(RESEND_API_KEY);
} else {
    console.warn("RESEND_API_KEY missing. /api/contact will return 503.");
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

    // users.json yapın: { "admin": { ... } }
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

// LOGIN
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
        console.error("Login error:", e);
        res.status(500).json({ error: "Giriş yapılamadı" });
    }
});

// PRICES (GET)
app.get("/api/prices", async (req, res) => {
    try {
        const pricesData = await fs.readFile(PRICES_FILE, "utf8");
        res.json(JSON.parse(pricesData));
    } catch (e) {
        console.error("Prices get error:", e);
        res.status(500).json({ error: "Fiyatlar alınamadı" });
    }
});

// PRICES (PUT) - protected
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
        console.error("Prices put error:", e);
        res.status(500).json({ error: "Fiyatlar güncellenemedi" });
    }
});

// CONTACT (Resend)
app.post("/api/contact", async (req, res) => {
    try {
        if (!resend) {
            return res.status(503).json({ error: "E-posta servisi yapılandırılmadı" });
        }

        const { name, surname, email, message } = req.body;
        if (!name || !surname || !email || !message) {
            return res.status(400).json({ error: "Tüm alanlar zorunludur" });
        }

        const safeName = escapeHtml(name);
        const safeSurname = escapeHtml(surname);
        const safeEmail = escapeHtml(email);
        const safeMessage = escapeHtml(message);

        const subject = `Yeni İletişim Formu Mesajı - ${safeName} ${safeSurname}`;

        const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6">
        <h2>Yeni İletişim Formu Mesajı</h2>
        <p><b>Ad:</b> ${safeName}</p>
        <p><b>Soyad:</b> ${safeSurname}</p>
        <p><b>Email:</b> ${safeEmail}</p>
        <p><b>Mesaj:</b><br/> ${safeMessage}</p>
      </div>
    `;

        const result = await resend.emails.send({
            from: EMAIL_FROM,           // örn: "Eyüboğulları <onboarding@resend.dev>" veya domain doğruladıysan "info@domain.com"
            to: [EMAIL_TO],             // mailin gideceği yer (senin mailin)
            reply_to: email,            // cevapla dediğinde kullanıcıya dönsün
            subject,
            html,
        });

        // Resend hata döndürürse:
        if (result.error) {
            console.error("Resend error:", result.error);
            return res.status(500).json({ error: "Mesaj gönderilemedi." });
        }

        res.json({ success: true, message: "Mesajınız başarıyla gönderildi." });
    } catch (e) {
        console.error("Contact error:", e);
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
