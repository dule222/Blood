const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_change_this';
const JWT_EXPIRY = '8h';

// ─── LOGIN ───
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username and password are required' 
            });
        }

        const userResult = await pool.query(`
            SELECT 
                u.*,
                r.role_name,
                a.agency_name,
                a.agency_code
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.role_id
            LEFT JOIN agencies a ON u.agency_id = a.agency_id
            WHERE u.username = $1 AND u.is_active = TRUE
        `, [username]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid username or password' 
            });
        }

        const user = userResult.rows[0];
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!isValidPassword) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid username or password' 
            });
        }

        await pool.query(
            `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1`,
            [user.user_id]
        );

        const token = jwt.sign(
            {
                user_id: user.user_id,
                username: user.username,
                role: user.role_name,
                agency_id: user.agency_id,
                agency_code: user.agency_code
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );

        res.json({
            success: true,
            message: 'Login successful',
            token: token,
            user: {
                user_id: user.user_id,
                username: user.username,
                full_name: user.full_name,
                email: user.email,
                role: user.role_name,
                agency_name: user.agency_name,
                agency_code: user.agency_code
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Server error during login' 
        });
    }
});

// ─── VERIFY TOKEN ───
router.get('/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'No token provided' 
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        
        const userResult = await pool.query(`
            SELECT 
                u.user_id,
                u.username,
                u.full_name,
                u.email,
                r.role_name,
                a.agency_name,
                a.agency_code
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.role_id
            LEFT JOIN agencies a ON u.agency_id = a.agency_id
            WHERE u.user_id = $1 AND u.is_active = TRUE
        `, [decoded.user_id]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'User not found or inactive' 
            });
        }

        res.json({
            success: true,
            user: userResult.rows[0]
        });

    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                error: 'Token expired' 
            });
        }
        res.status(401).json({ 
            success: false, 
            error: 'Invalid token' 
        });
    }
});

// ─── REGISTER USER (Admin Only) ───
router.post('/register', async (req, res) => {
    try {
        const { username, password, email, full_name, role_name, agency_code } = req.body;

        if (!username || !password || !full_name || !role_name) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username, password, full name, and role are required' 
            });
        }

        const existing = await pool.query(
            `SELECT user_id FROM users WHERE username = $1`,
            [username]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username already exists' 
            });
        }

        const roleResult = await pool.query(
            `SELECT role_id FROM roles WHERE role_name = $1`,
            [role_name]
        );
        if (roleResult.rows.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid role' 
            });
        }
        const role_id = roleResult.rows[0].role_id;

        let agency_id = null;
        if (agency_code) {
            const agencyResult = await pool.query(
                `SELECT agency_id FROM agencies WHERE agency_code = $1`,
                [agency_code]
            );
            if (agencyResult.rows.length > 0) {
                agency_id = agencyResult.rows[0].agency_id;
            }
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const result = await pool.query(`
            INSERT INTO users (username, password_hash, email, full_name, role_id, agency_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING user_id, username, email, full_name
        `, [username, passwordHash, email, full_name, role_id, agency_id]);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            user: result.rows[0]
        });

    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Server error during registration' 
        });
    }
});

module.exports = router;