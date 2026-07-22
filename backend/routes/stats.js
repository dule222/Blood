const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─── GET all statistics ───
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM donors) AS total_donors,
                (SELECT COUNT(*) FROM donors WHERE registration_status = 'Active') AS active_donors,
                
                -- Overall status counts
                (SELECT COUNT(*) FROM donors WHERE status = 'Eligible Donor' OR status IS NULL) AS eligible_donors,
                (SELECT COUNT(*) FROM donors WHERE status LIKE '%Deferred%' OR status LIKE '%deferred%') AS total_deferred,
                (SELECT COUNT(*) FROM donors WHERE status LIKE '%Permanent%' OR status LIKE '%permanent%') AS perm_deferred,
                (SELECT COUNT(*) FROM donors WHERE status LIKE '%Temporary%' OR status LIKE '%temporary%' OR status LIKE '%1 Year%') AS temp_deferred,
                
                -- Disease positive counts
                (SELECT COUNT(DISTINCT donor_id) FROM donor_disease_tests 
                 WHERE disease_id = 1 AND result IN ('Reactive', 'Positive')) AS hiv_positive,
                (SELECT COUNT(DISTINCT donor_id) FROM donor_disease_tests 
                 WHERE disease_id = 2 AND result IN ('Reactive', 'Detected')) AS hbv_positive,
                (SELECT COUNT(DISTINCT donor_id) FROM donor_disease_tests 
                 WHERE disease_id = 3 AND result IN ('Reactive', 'Detected')) AS hcv_positive,
                (SELECT COUNT(DISTINCT donor_id) FROM donor_disease_tests 
                 WHERE disease_id = 4 AND result = 'Reactive') AS syphilis_positive,
                (SELECT COUNT(DISTINCT donor_id) FROM donor_disease_tests 
                 WHERE disease_id = 5 AND result = 'Detected') AS malaria_positive,
                
                -- Test counts
                (SELECT COUNT(*) FROM donor_disease_tests) AS total_tests,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE result IN ('Reactive', 'Positive', 'Detected')) AS positive_tests,
                
                -- Recent activity
                (SELECT COUNT(*) FROM donors WHERE last_donation >= CURRENT_DATE - INTERVAL '30 days') AS recent_donors,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE result_date >= CURRENT_DATE - INTERVAL '7 days') AS tests_this_week
        `);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET disease-specific stats ───
router.get('/disease/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const result = await pool.query(`
            SELECT 
                d.disease_id,
                d.disease_name,
                d.disease_code,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE disease_id = d.disease_id) AS total_tests,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE disease_id = d.disease_id AND result IN ('Reactive', 'Positive', 'Detected')) AS positive_tests,
                (SELECT COUNT(DISTINCT donor_id) FROM donor_disease_tests WHERE disease_id = d.disease_id AND result IN ('Reactive', 'Positive', 'Detected')) AS unique_positive_donors,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE disease_id = d.disease_id AND result = 'Indeterminate') AS indeterminate_tests,
                (SELECT MAX(result_date) FROM donor_disease_tests WHERE disease_id = d.disease_id) AS last_test_date
            FROM diseases d
            WHERE d.disease_code = $1
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

// ─── GET dashboard overview ───
router.get('/dashboard', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM donors) AS total_donors,
                (SELECT COUNT(*) FROM donors WHERE registration_status = 'Active') AS active_donors,
                (SELECT COUNT(*) FROM donors WHERE status = 'Eligible Donor' OR status IS NULL) AS eligible,
                (SELECT COUNT(*) FROM donors WHERE status LIKE '%Deferred%') AS deferred,
                (SELECT COUNT(*) FROM donors WHERE status LIKE '%Permanent%') AS perm_deferred,
                (SELECT COUNT(*) FROM donors WHERE status LIKE '%Temporary%' OR status LIKE '%1 Year%') AS temp_deferred
        `);

        const diseases = await pool.query(`
            SELECT 
                d.disease_code,
                d.disease_name,
                COUNT(DISTINCT ddt.donor_id) FILTER (WHERE ddt.result IN ('Reactive', 'Positive', 'Detected')) AS positive_donors,
                COUNT(ddt.test_id) AS total_tests
            FROM diseases d
            LEFT JOIN donor_disease_tests ddt ON d.disease_id = ddt.disease_id
            GROUP BY d.disease_id, d.disease_code, d.disease_name
            ORDER BY d.disease_name
        `);

        res.json({
            overview: stats.rows[0],
            diseases: diseases.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;