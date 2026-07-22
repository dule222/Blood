const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_change_this';

// ─── AUTHENTICATE - Verify JWT Token ───
async function authenticate(req, res, next) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required' 
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        
        const userResult = await pool.query(`
            SELECT 
                u.*,
                r.role_name
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.role_id
            WHERE u.user_id = $1 AND u.is_active = TRUE
        `, [decoded.user_id]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'User not found or inactive' 
            });
        }

        req.user = userResult.rows[0];
        req.user.role = userResult.rows[0].role_name;
        
        next();

    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                error: 'Session expired. Please login again.' 
            });
        }
        res.status(401).json({ 
            success: false, 
            error: 'Invalid authentication token' 
        });
    }
}

// ─── AUTHORIZE - Check User Role ───
function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required' 
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false, 
                error: `Access denied. Required role: ${allowedRoles.join(' or ')}` 
            });
        }

        next();
    };
}

// ─── AUTHORIZE - Check Agency Access ───
function authorizeAgency() {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required' 
            });
        }

        if (['admin', 'director'].includes(req.user.role)) {
            return next();
        }

        const agencyId = parseInt(req.params.agencyId) || parseInt(req.body.agency_id) || 
                         parseInt(req.query.agency_id) || req.user.agency_id;
        
        if (req.user.agency_id && req.user.agency_id !== agencyId) {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. You can only access your own agency data.' 
            });
        }

        next();
    };
}

module.exports = {
    authenticate,
    authorize,
    authorizeAgency
};