const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Database setup
const db = new sqlite3.Database('./vtcs_exams.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initDatabase();
    }
});

// Initialize database tables
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

    // Set default admin password (change this!)
    const defaultPassword = 'admin123';
    db.get('SELECT * FROM admin_settings WHERE id = 1', (err, row) => {
        if (!row) {
            db.run('INSERT INTO admin_settings (password_hash) VALUES (?)', [defaultPassword]);
            console.log('Default admin password set to: admin123 (PLEASE CHANGE THIS!)');
        }
    });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /pdf|doc|docx|txt|png|jpg|jpeg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only PDF, DOC, DOCX, TXT, and image files are allowed!'));
        }
    }
});

// API Routes

// Verify admin password
app.post('/api/verify-password', (req, res) => {
    const { password } = req.body;
    
    db.get('SELECT password_hash FROM admin_settings WHERE id = 1', (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (row && row.password_hash === password) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Incorrect password' });
        }
    });
});

// Change admin password
app.post('/api/change-password', (req, res) => {
    const { oldPassword, newPassword } = req.body;
    
    db.get('SELECT password_hash FROM admin_settings WHERE id = 1', (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (row && row.password_hash === oldPassword) {
            db.run('UPDATE admin_settings SET password_hash = ? WHERE id = 1', [newPassword], (err) => {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Failed to update password' });
                }
                res.json({ success: true, message: 'Password changed successfully' });
            });
        } else {
            res.json({ success: false, message: 'Incorrect old password' });
        }
    });
});

// Upload file content
app.post('/api/upload-file', upload.single('file'), (req, res) => {
    const { subject, feature, chapter } = req.body;
    
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    const filePath = '/uploads/' + req.file.filename;
    
    db.run(`INSERT OR REPLACE INTO content 
            (subject, feature, chapter, content_type, file_path, updated_at) 
            VALUES (?, ?, ?, 'file', ?, CURRENT_TIMESTAMP)`,
        [subject, feature, chapter, filePath],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ 
                success: true, 
                message: 'File uploaded successfully',
                filePath: filePath
            });
        }
    );
});

// Save text content
app.post('/api/save-text', (req, res) => {
    const { subject, feature, chapter, content } = req.body;
    
    db.run(`INSERT OR REPLACE INTO content 
            (subject, feature, chapter, content_type, text_content, updated_at) 
            VALUES (?, ?, ?, 'text', ?, CURRENT_TIMESTAMP)`,
        [subject, feature, chapter, content],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ 
                success: true, 
                message: 'Content saved successfully'
            });
        }
    );
});

// Get content for a chapter
app.get('/api/content/:subject/:feature/:chapter', (req, res) => {
    const { subject, feature, chapter } = req.params;
    
    db.get(`SELECT * FROM content WHERE subject = ? AND feature = ? AND chapter = ?`,
        [subject, feature, chapter],
        (err, row) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            
            if (row) {
                res.json({ 
                    success: true, 
                    content: row
                });
            } else {
                res.json({ 
                    success: false, 
                    message: 'No content found'
                });
            }
        }
    );
});

// Get all content (for admin)
app.get('/api/all-content', (req, res) => {
    db.all('SELECT * FROM content ORDER BY subject, feature, chapter', (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, content: rows });
    });
});

// Delete content
app.delete('/api/content/:id', (req, res) => {
    const { id } = req.params;
    
    // First get the file path to delete the file
    db.get('SELECT file_path FROM content WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (row && row.file_path) {
            // Extract just the filename from the path
            const filename = path.basename(row.file_path);
            const filePath = path.join(__dirname, 'uploads', filename);
            
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        // Delete from database
        db.run('DELETE FROM content WHERE id = ?', [id], function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Failed to delete' });
            }
            res.json({ success: true, message: 'Content deleted successfully' });
        });
    });
});

// Serve uploaded files with proper download headers
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, 'uploads', filename);
    
    if (fs.existsSync(filepath)) {
        res.download(filepath);
    } else {
        res.status(404).json({ success: false, message: 'File not found' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Default admin password: admin123');
    console.log('IMPORTANT: Change the password immediately after first login!');
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        console.log('\nDatabase connection closed');
        process.exit(0);
    });
});