const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─── GET all diseases ───
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                d.*,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE disease_id = d.disease_id) AS test_count,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE disease_id = d.disease_id AND result IN ('Reactive', 'Positive', 'Detected')) AS positive_count
            FROM diseases d
            WHERE d.is_active = TRUE
            ORDER BY d.disease_name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET disease by code ───
router.get('/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const result = await pool.query(`
            SELECT * FROM diseases WHERE disease_code = $1
        `, [code.toUpperCase()]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Disease not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET disease algorithm ───
router.get('/:code/algorithm', async (req, res) => {
    try {
        const { code } = req.params;
        const result = await pool.query(`
            SELECT 
                da.*,
                a.agency_name,
                a.agency_type
            FROM disease_algorithms da
            JOIN diseases d ON da.disease_id = d.disease_id
            LEFT JOIN agencies a ON da.agency_id = a.agency_id
            WHERE d.disease_code = $1
            ORDER BY da.phase
        `, [code.toUpperCase()]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;