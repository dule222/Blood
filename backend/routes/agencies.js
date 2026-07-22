const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');

// ─── Helper: Generate API Key ───
function generateApiKey(agencyCode) {
    const random = crypto.randomBytes(16).toString('hex');
    return `${agencyCode.toLowerCase()}_${random}`;
}

// ─── GET all agencies ───
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                a.*,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE agency_id = a.agency_id) AS test_count,
                (SELECT MAX(result_date) FROM donor_disease_tests WHERE agency_id = a.agency_id) AS last_activity,
                (SELECT COUNT(*) FROM users WHERE agency_id = a.agency_id) AS user_count
            FROM agencies a
            ORDER BY a.agency_name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching agencies:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET active agencies only ───
router.get('/active', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                a.*,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE agency_id = a.agency_id) AS test_count
            FROM agencies a
            WHERE a.is_active = TRUE
            ORDER BY a.agency_name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching active agencies:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET single agency ───
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT 
                a.*,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE agency_id = a.agency_id) AS test_count,
                (SELECT COUNT(*) FROM users WHERE agency_id = a.agency_id) AS user_count,
                (SELECT MAX(result_date) FROM donor_disease_tests WHERE agency_id = a.agency_id) AS last_activity
            FROM agencies a
            WHERE a.agency_id = $1 OR a.agency_code = $1
        `, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Agency not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching agency:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET agency by API key ───
router.get('/by-key/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        const result = await pool.query(`
            SELECT * FROM agencies WHERE api_key = $1 AND is_active = TRUE
        `, [apiKey]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid or inactive API key' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching agency by API key:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── POST create agency ───
router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { 
            agency_name, 
            agency_code, 
            agency_type, 
            address, 
            city, 
            state, 
            phone, 
            email, 
            api_endpoint, 
            api_key,
            is_active 
        } = req.body;

        // Validate required fields
        if (!agency_name || !agency_code || !agency_type) {
            return res.status(400).json({ 
                error: 'Agency name, code, and type are required' 
            });
        }

        // Check if agency code already exists
        const existing = await client.query(
            `SELECT agency_id FROM agencies WHERE agency_code = $1`,
            [agency_code]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ 
                error: `Agency code '${agency_code}' already exists` 
            });
        }

        // Generate API key if not provided
        const finalApiKey = api_key || generateApiKey(agency_code);

        // Check if API key already exists
        const keyExists = await client.query(
            `SELECT agency_id FROM agencies WHERE api_key = $1`,
            [finalApiKey]
        );
        if (keyExists.rows.length > 0) {
            // Regenerate if conflict
            finalApiKey = generateApiKey(agency_code);
        }

        const result = await client.query(`
            INSERT INTO agencies (
                agency_name, 
                agency_code, 
                agency_type, 
                address, 
                city, 
                state, 
                phone, 
                email, 
                api_endpoint, 
                api_key, 
                is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            agency_name, 
            agency_code, 
            agency_type, 
            address || null, 
            city || null, 
            state || null, 
            phone || null, 
            email || null, 
            api_endpoint || null, 
            finalApiKey, 
            is_active !== undefined ? is_active : true
        ]);

        // Log the creation
        console.log(`🏛️ New agency created: ${agency_name} (${agency_code})`);
        console.log(`🔑 API Key: ${finalApiKey}`);

        res.status(201).json({
            success: true,
            message: `Agency '${agency_name}' created successfully`,
            agency: result.rows[0],
            api_key: finalApiKey
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating agency:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// ─── PUT update agency ───
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            agency_name, 
            agency_type, 
            address, 
            city, 
            state, 
            phone, 
            email, 
            api_endpoint, 
            api_key, 
            is_active 
        } = req.body;

        // Check if agency exists
        const existing = await pool.query(
            `SELECT * FROM agencies WHERE agency_id = $1 OR agency_code = $1`,
            [id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Agency not found' });
        }

        const result = await pool.query(`
            UPDATE agencies 
            SET 
                agency_name = COALESCE($1, agency_name),
                agency_type = COALESCE($2, agency_type),
                address = COALESCE($3, address),
                city = COALESCE($4, city),
                state = COALESCE($5, state),
                phone = COALESCE($6, phone),
                email = COALESCE($7, email),
                api_endpoint = COALESCE($8, api_endpoint),
                api_key = COALESCE($9, api_key),
                is_active = COALESCE($10, is_active),
                updated_at = CURRENT_TIMESTAMP
            WHERE agency_id = $11 OR agency_code = $11
            RETURNING *
        `, [
            agency_name, 
            agency_type, 
            address, 
            city, 
            state, 
            phone, 
            email, 
            api_endpoint, 
            api_key, 
            is_active,
            id
        ]);

        res.json({
            success: true,
            message: `Agency updated successfully`,
            agency: result.rows[0]
        });

    } catch (err) {
        console.error('Error updating agency:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── PATCH regenerate API key ───
router.patch('/:id/regenerate-key', async (req, res) => {
    try {
        const { id } = req.params;

        // Get agency
        const existing = await pool.query(
            `SELECT agency_code FROM agencies WHERE agency_id = $1 OR agency_code = $1`,
            [id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Agency not found' });
        }

        const agencyCode = existing.rows[0].agency_code;
        const newApiKey = generateApiKey(agencyCode);

        const result = await pool.query(`
            UPDATE agencies 
            SET api_key = $1, updated_at = CURRENT_TIMESTAMP
            WHERE agency_id = $2 OR agency_code = $2
            RETURNING *
        `, [newApiKey, id]);

        res.json({
            success: true,
            message: 'API key regenerated successfully',
            agency: result.rows[0],
            new_api_key: newApiKey
        });

    } catch (err) {
        console.error('Error regenerating API key:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── DELETE agency (soft delete) ───
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if agency exists
        const existing = await pool.query(
            `SELECT * FROM agencies WHERE agency_id = $1 OR agency_code = $1`,
            [id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Agency not found' });
        }

        // Soft delete - set inactive
        const result = await pool.query(`
            UPDATE agencies 
            SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE agency_id = $1 OR agency_code = $1
            RETURNING *
        `, [id]);

        res.json({
            success: true,
            message: 'Agency deactivated successfully',
            agency: result.rows[0]
        });

    } catch (err) {
        console.error('Error deleting agency:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET agency statistics ───
router.get('/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM donor_disease_tests WHERE agency_id = a.agency_id) AS total_tests,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE agency_id = a.agency_id AND result IN ('Reactive', 'Positive', 'Detected')) AS reactive_tests,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE agency_id = a.agency_id AND result_date >= CURRENT_DATE - INTERVAL '30 days') AS tests_this_month,
                (SELECT COUNT(DISTINCT donor_id) FROM donor_disease_tests WHERE agency_id = a.agency_id) AS unique_donors,
                (SELECT MAX(result_date) FROM donor_disease_tests WHERE agency_id = a.agency_id) AS last_activity
            FROM agencies a
            WHERE a.agency_id = $1 OR a.agency_code = $1
        `, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Agency not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching agency stats:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;