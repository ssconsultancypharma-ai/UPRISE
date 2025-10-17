const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt'); // 🔐 added for password hashing

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ STRONG CORS SETUP (Frontend + Local Dev)
app.use(cors({
  origin: [
    'https://uprise-git-main-ssconsultancypharma-ais-projects.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5500'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 🧩 SQLite Database setup
const db = new sqlite3.Database('./vtcs_exams.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('✅ Connected to SQLite database');
    initDatabase();
  }
});

function initDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    feature TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    file_path TEXT,
    text_content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(subject, feature, chapter)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    password_hash TEXT NOT NULL
  )`);

  // Default admin password (hashed)
  const defaultPassword = 'admin123';
  db.get('SELECT * FROM admin_settings WHERE id = 1', async (err, row) => {
    if (!row) {
      const hash = await bcrypt.hash(defaultPassword, 10);
      db.run('INSERT INTO admin_settings (password_hash) VALUES (?)', [hash]);
      console.log('🔑 Default admin password set to: admin123 (please change it!)');
    }
  });
}

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|doc|docx|txt|png|jpg|jpeg/;
    const valid = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
    valid ? cb(null, true) : cb(new Error('Only PDF, DOCX, TXT, and image files are allowed!'));
  }
});

// 🩺 Health Check
app.get('/api/health', (req, res) => res.json({ success: true, message: 'Backend running properly!' }));

// 🔐 Verify Password
app.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  db.get('SELECT password_hash FROM admin_settings WHERE id = 1', async (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (row && await bcrypt.compare(password, row.password_hash)) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false, message: 'Incorrect password' });
    }
  });
});

// 🔑 Change Password
app.post('/api/change-password', (req, res) => {
  const { oldPassword, newPassword } = req.body;
  db.get('SELECT password_hash FROM admin_settings WHERE id = 1', async (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });

    if (row && await bcrypt.compare(oldPassword, row.password_hash)) {
      const newHash = await bcrypt.hash(newPassword, 10);
      db.run('UPDATE admin_settings SET password_hash = ? WHERE id = 1', [newHash], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Failed to update password' });
        res.json({ success: true, message: 'Password updated successfully!' });
      });
    } else {
      res.json({ success: false, message: 'Old password incorrect' });
    }
  });
});

// 📤 Upload File
app.post('/api/upload-file', upload.single('file'), (req, res) => {
  const { subject, feature, chapter } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

  const filePath = '/uploads/' + req.file.filename;
  db.run(`INSERT OR REPLACE INTO content 
          (subject, feature, chapter, content_type, file_path, updated_at) 
          VALUES (?, ?, ?, 'file', ?, CURRENT_TIMESTAMP)`,
    [subject, feature, chapter, filePath],
    function (err) {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, message: 'File uploaded successfully', filePath });
    }
  );
});

// 📝 Save Text
app.post('/api/save-text', (req, res) => {
  const { subject, feature, chapter, content } = req.body;
  db.run(`INSERT OR REPLACE INTO content 
          (subject, feature, chapter, content_type, text_content, updated_at) 
          VALUES (?, ?, ?, 'text', ?, CURRENT_TIMESTAMP)`,
    [subject, feature, chapter, content],
    (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, message: 'Text saved successfully' });
    }
  );
});

// 📚 Fetch Content
app.get('/api/content/:subject/:feature/:chapter', (req, res) => {
  const { subject, feature, chapter } = req.params;
  db.get(`SELECT * FROM content WHERE subject = ? AND feature = ? AND chapter = ?`,
    [subject, feature, chapter],
    (err, row) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      if (row) res.json({ success: true, content: row });
      else res.json({ success: false, message: 'No content found' });
    });
});

// 🧾 List All Content
app.get('/api/all-content', (req, res) => {
  db.all('SELECT * FROM content ORDER BY subject, feature, chapter', (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    res.json({ success: true, content: rows });
  });
});

// ❌ Delete Content
app.delete('/api/content/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT file_path FROM content WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error' });
    if (row && row.file_path) {
      const filename = path.basename(row.file_path);
      const filePath = path.join(__dirname, 'uploads', filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.run('DELETE FROM content WHERE id = ?', [id], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Delete failed' });
      res.json({ success: true, message: 'Deleted successfully' });
    });
  });
});

// 📎 Download Files
app.get('/download/:filename', (req, res) => {
  const filepath = path.join(__dirname, 'uploads', req.params.filename);
  if (fs.existsSync(filepath)) res.download(filepath);
  else res.status(404).json({ success: false, message: 'File not found' });
});

// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log('Frontend: https://uprise-git-main-ssconsultancypharma-ais-projects.vercel.app');
  console.log('Backend:  https://uprise-8vgb.onrender.com');
});

// 🧹 Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error('Error closing DB:', err);
    console.log('\n🟢 Database closed');
    process.exit(0);
  });
});
