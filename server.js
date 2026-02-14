const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

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
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://merttburma-arch.github.io";

// ===== CORS =====
const allowedOrigins = new Set([
    "http://localhost:3000",
    FRONTEND_ORIGIN,
]);

app.use(
    cors({
        origin: function (origin, cb) {
            if (!origin) return cb(null, true); // curl/postman
            if (allowedOrigins.has(origin)) return cb(null, true);
            return cb(new Error("CORS not allowed: " + origin));
        },
    })
);

app.use(express.json());

// ===== DATA PATH =====
// Railway’de yazılabilir ve kolay olan: /tmp
// Sen env vermezsen otomatik /tmp/eyupogullar-data kullanacağız.
const DATA_DIR = process.env.DATA_DIR || "/tmp/eyupogullar-data";
const PRICES_FILE = path.join(DATA_DIR, "prices.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// ===== Email transporter =====
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
} else {
    console.warn("EMAIL_USER/EMAIL_PASS env missing. /api/contact will return 503.");
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
        districts: [
            { name: "Arnavutköy", cost: 400 },
            { name: "Ataşehir", cost: 300 },
            { name: "Avcılar", cost: 100 },
            { name: "Bağcılar", cost: 150 },
            { name: "Bahçelievler", cost: 150 },
            { name: "Bakırköy", cost: 200 },
            { name: "Başakşehir", cost: 250 },
            { name: "Bayrampaşa", cost: 200 },
            { name: "Beşiktaş", cost: 350 },
            { name: "Beykoz", cost: 400 },
            { name: "Beylikdüzü", cost: 50 },
            { name: "Beyoğlu", cost: 300 },
            { name: "Büyükçekmece", cost: 150 },
            { name: "Çatalca", cost: 600 },
            { name: "Çekmeköy", cost: 350 },
            { name: "Esenler", cost: 200 },
            { name: "Esenyurt", cost: 0 },
            { name: "Eyüpsultan", cost: 250 },
            { name: "Fatih", cost: 300 },
            { name: "Gaziosmanpaşa", cost: 250 },
            { name: "Güngören", cost: 200 },
            { name: "Kadıköy", cost: 350 },
            { name: "Kağıthane", cost: 250 },
            { name: "Kartal", cost: 300 },
            { name: "Küçükçekmece", cost: 150 },
            { name: "Maltepe", cost: 300 },
            { name: "Pendik", cost: 350 },
            { name: "Sancaktepe", cost: 400 },
            { name: "Sarıyer", cost: 400 },
            { name: "Silivri", cost: 700 },
            { name: "Sultanbeyli", cost: 400 },
            { name: "Sultangazi", cost: 300 },
            { name: "Şile", cost: 800 },
            { name: "Şişli", cost: 300 },
            { name: "Tuzla", cost: 400 },
            { name: "Ümraniye", cost: 350 },
            { name: "Üsküdar", cost: 350 },
            { name: "Zeytinburnu", cost: 250 },
        ],
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
        if (!transporter) {
            return res.status(503).json({ error: "E-posta servisi yapılandırılmadı" });
        }

        const { name, surname, email, message } = req.body;
        if (!name || !surname || !email || !message) {
            return res.status(400).json({ error: "Tüm alanlar zorunludur" });
        }

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: `Yeni İletişim Formu Mesajı - ${escapeHtml(name)} ${escapeHtml(surname)}`,
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e40af; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0;">Eyüboğulları İnşaat</h2>
            <p style="margin: 5px 0 0 0;">Yeni İletişim Formu Mesajı</p>
          </div>

          <div style="padding: 20px; background: #f9fafb;">
            <div style="margin-bottom: 15px;"><strong>Adı:</strong> ${escapeHtml(name)}</div>
            <div style="margin-bottom: 15px;"><strong>Soyadı:</strong> ${escapeHtml(surname)}</div>
            <div style="margin-bottom: 15px;"><strong>E-posta:</strong> ${escapeHtml(email)}</div>
            <div style="margin-bottom: 15px;"><strong>Mesaj:</strong></div>
            <div style="background: white; padding: 15px; border-left: 4px solid #1e40af; white-space: pre-wrap;">${escapeHtml(message)}</div>
          </div>

          <div style="background: #1f2937; color: white; padding: 15px; text-align: center; font-size: 12px;">
            <p style="margin: 0;">Bu mesaj ${new Date().toLocaleString("tr-TR")} tarihinde gönderildi.</p>
          </div>
        </div>
      `,
        };

        await transporter.sendMail(mailOptions);

        res.json({
            success: true,
            message: "Mesajınız başarıyla gönderildi. En kısa sürede size dönüş yapacağız.",
        });
    } catch (e) {
        console.error("E-posta gönderme hatası:", e);
        res.status(500).json({ error: "Mesaj gönderilemedi. Lütfen daha sonra tekrar deneyin." });
    }
});

app.get("/", (req, res) => {
    res.json({ message: "Eyüboğulları İnşaat Backend API" });
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

    // 10 sn içinde kapanmazsa zorla
    setTimeout(() => {
        console.log("Force exit.");
        process.exit(1);
    }, 10_000);
});
