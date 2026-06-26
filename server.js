const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname)));
app.use(express.json());

// --- RESİM YÜKLEME AYARI (MULTER) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "images/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });
app.use("/images", express.static(path.join(__dirname, "images")));

// --- TICK RATE HESAPLAMA ---
let tickCount = 0;
let currentTickRate = 0;
let lastTickTime = Date.now();
setInterval(() => {
  tickCount++;
  const simdi = Date.now();
  if (simdi - lastTickTime >= 1000) {
    currentTickRate = tickCount;
    tickCount = 0;
    lastTickTime = simdi;
  }
}, 1);

// --- VERİTABANI BAĞLANTI VE TABLO KURUMLARI ---
const db = new sqlite3.Database("./Organic.db", (hata) => {
  if (hata) {
    console.error("Veri tabanına bağlanırken hata oluştu:", hata.message);
  } else {
    console.log("Organic.db veri tabanına başarıyla bağlanıldı.");
    tablolariKur();
  }
});

function tablolariKur() {
  // 1. Admin Kullanıcıları Tablosu
  db.run(
    `CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
    )`,
    (err) => {
      if (!err) {
        // Varsayılan admin hesabı ekle (Eğer yoksa)
        db.get(
          `SELECT * FROM admin_users WHERE username = 'admin'`,
          [],
          (err, row) => {
            if (!row) {
              db.run(
                `INSERT INTO admin_users (username, password) VALUES ('admin', 'admin123')`,
              );
            }
          },
        );
      }
    },
  );

  // 2. Ürünler Tablosu
  db.run(`CREATE TABLE IF NOT EXISTS urunler (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        isim TEXT NOT NULL,
        fiyat REAL NOT NULL,
        gorsel TEXT
    )`);

  // 3. Sistem Ayarları (Telegram) Tablosu
  db.run(
    `CREATE TABLE IF NOT EXISTS sistem_ayarlari (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anahtar TEXT UNIQUE,
        deger TEXT
    )`,
    (err) => {
      if (!err) {
        db.run(
          `INSERT OR IGNORE INTO sistem_ayarlari (anahtar, deger) VALUES ('telegram_token', '8505843688:AAFjnEhPqtd121-ciJGtri_Mw4neX6uX84c')`,
        );
        db.run(
          `INSERT OR IGNORE INTO sistem_ayarlari (anahtar, deger) VALUES ('market_chat_id', '6527242600')`,
        );
        db.run(
          `INSERT OR IGNORE INTO sistem_ayarlari (anahtar, deger) VALUES ('kurye_chat_id', '6527242600')`,
        );
      }
    },
  );

  // 4. IP Logları Tablosu
  db.run(`CREATE TABLE IF NOT EXISTS ip_loglari (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_adresi TEXT,
        tarih TEXT
    )`);

  // 5. Banlı IP'ler Tablosu
  db.run(`CREATE TABLE IF NOT EXISTS banli_ipler (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL UNIQUE,
    sebep TEXT,
    tarih TEXT
)`);
}

// --- API ENDPOINTLERİ ---

// 1. Admin Login Kapısı
app.post("/api/admin-login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Lütfen kullanıcı adı ve şifre girin.",
      });
  }

  const query = `SELECT * FROM admin_users WHERE username = ? AND password = ?`;
  db.get(query, [username, password], (err, row) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Veritabanı hatası." });
    }
    if (row) {
      // Giriş başarılıysa token fırlatıyoruz
      return res.json({
        success: true,
        message: "Giriş başarılı!",
        token: "secure_admin_token_998877",
      });
    } else {
      return res
        .status(401)
        .json({ success: false, message: "Kullanıcı adı veya şifre hatalı!" });
    }
  });
});

// 2. Sistem Durumu ve IP Logları (Admin Panel Canlı Veri)
app.get("/api/sistem-durumu", (istek, cevap) => {
  db.all(
    `SELECT ip_adresi, tarih FROM ip_loglari ORDER BY id DESC LIMIT 5`,
    [],
    (hata, satirlar) => {
      if (hata) return cevap.status(500).json({ hata: hata.message });
      cevap.json({
        tickRate: currentTickRate,
        sonGirisler: satirlar || [],
      });
    },
  );
});

// 3. Telegram Ayarlarını Çekme
app.get("/api/telegram-ayarlari", (istek, cevap) => {
  db.all(`SELECT * FROM sistem_ayarlari`, [], (hata, satirlar) => {
    if (hata) return cevap.status(500).json({ hata: hata.message });
    const ayarlar = {};
    satirlar.forEach((satir) => {
      ayarlar[satir.anahtar] = satir.deger;
    });
    cevap.json(ayarlar);
  });
});

// 4. Ürün Ekleme (Görsel Yükleme Destekli)
app.post("/api/urun-ekle", upload.single("urunResmi"), (istek, cevap) => {
  const { isim, fiyat } = istek.body;
  let gorselYolu = "images/default.png";
  if (istek.file) {
    gorselYolu = "images/" + istek.file.filename;
  }

  const sorgu = `INSERT INTO urunler(isim, fiyat, gorsel) VALUES (?, ?, ?)`;
  db.run(sorgu, [isim, fiyat, gorselYolu], function (hata) {
    if (hata) {
      return cevap.status(500).json({ durum: "hata", mesaj: hata.message });
    }
    cevap.json({
      durum: "başarılı",
      mesaj: "Ürün başarıyla kaydedildi!",
      id: this.lastID,
    });
  });
});

// [KAPI] Veritabanındaki Tüm Ürünleri Listeleme Kapısı
app.get("/api/urunler", (istek, cevap) => {
  const sorgu = `SELECT * FROM urunler ORDER BY id DESC`;
  db.all(sorgu, [], (hata, satirlar) => {
    if (hata) {
      console.error("Ürünler getirilemedi:", hata.message);
      return cevap.status(500).json({ durum: "hata", mesaj: hata.message });
    }
    cevap.json(satirlar || []); // Boşsa boş array döner, asla HTML dönmez!
  });
});

// [KAPI] Ürün Silme Kapısı
app.delete("/api/urun-sil/:id", (istek, cevap) => {
  const urunId = istek.params.id;
  const sorgu = `DELETE FROM urunler WHERE id = ?`;

  db.run(sorgu, [urunId], function (hata) {
    if (hata) {
      console.error("Ürün silinirken hata oluştu:", hata.message);
      return cevap.status(500).json({ durum: "hata", mesaj: hata.message });
    }
    cevap.json({
      durum: "başarılı",
      mesaj: "Ürün başarıyla veritabanından silindi!",
    });
  });
});
// --- IP YÖNETİMİ İÇİN YENİ ENDPOINT'LER ---

// 1. IP Loglama (Ziyaretçi geldiğinde kaydet)
app.use((req, res, next) => {
  // Sadece index.html ve ana sayfa isteklerini logla
  if (req.path === "/" || req.path === "/index.html") {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    // IPv6'dan IPv4 çıkarımı (::ffff:127.0.0.1 -> 127.0.0.1)
    const cleanIp = ip.replace("::ffff:", "");

    // Banlı IP kontrolü
    db.get(
      `SELECT * FROM banli_ipler WHERE ip = ?`,
      [cleanIp],
      (err, banli) => {
        if (!banli) {
          // Banlı değilse logla
          const tarih = new Date().toISOString();
          db.run(`INSERT INTO ip_loglari (ip_adresi, tarih) VALUES (?, ?)`, [
            cleanIp,
            tarih,
          ]);
        }
      },
    );
  }
  next();
});

// 2. Tüm IP Loglarını Getir (Admin panel için)
app.get("/api/ip-loglari", (req, res) => {
  db.all(`SELECT * FROM ip_loglari ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ hata: err.message });
    res.json(rows || []);
  });
});

// 3. IP Banla
app.post("/api/ip-banla", (req, res) => {
  const { ip, sebep } = req.body;
  if (!ip)
    return res.status(400).json({ durum: "hata", mesaj: "IP adresi gerekli" });

const tarih = new Date().toISOString();  db.run(
    `INSERT INTO banli_ipler (ip, sebep, tarih) VALUES (?, ?, ?)`,
    [ip, sebep || "Yönetici tarafından banlandı", tarih],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE")) {
          return res.json({ durum: "hata", mesaj: "Bu IP zaten banlı!" });
        }
        return res.status(500).json({ durum: "hata", mesaj: err.message });
      }
      res.json({ durum: "başarılı", mesaj: "IP başarıyla banlandı!" });
    },
  );
});

// 4. IP Banını Kaldır
app.delete("/api/ip-ban-kaldir/:ip", (req, res) => {
  const ip = req.params.ip;
  db.run(`DELETE FROM banli_ipler WHERE ip = ?`, [ip], function (err) {
    if (err) return res.status(500).json({ durum: "hata", mesaj: err.message });
    if (this.changes === 0) {
      return res.json({ durum: "hata", mesaj: "Bu IP banlı değil!" });
    }
    res.json({ durum: "başarılı", mesaj: "IP banı kaldırıldı!" });
  });
});

// 5. Banlı IP Listesini Getir
app.get("/api/banli-ipler", (req, res) => {
  db.all(`SELECT * FROM banli_ipler ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ hata: err.message });
    res.json(rows || []);
  });
});

// 6. IP Loglarını Temizle
app.delete("/api/ip-loglarini-temizle", (req, res) => {
  db.run(`DELETE FROM ip_loglari`, function (err) {
    if (err) return res.status(500).json({ durum: "hata", mesaj: err.message });
    res.json({ durum: "başarılı", mesaj: "Tüm IP logları temizlendi!" });
  });
});
// Sunucuyu Başlat
app.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde aktif!`);
});
