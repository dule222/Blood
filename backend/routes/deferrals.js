const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─── GET all deferrals ───
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                d.*,
                donor.donor_uid,
                donor.first_name || ' ' || donor.last_name AS donor_name,
                donor.blood_group
            FROM deferrals d
            JOIN donors donor ON d.donor_id = donor.donor_id
            WHERE d.is_reinstated = FALSE
            ORDER BY d.deferral_date DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET deferrals for a donor ───
router.get('/donor/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT * FROM deferrals 
            WHERE donor_id = (SELECT donor_id FROM donors WHERE donor_uid = $1 OR donor_id::text = $1)
            ORDER BY deferral_date DESC
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── POST create deferral ───
router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { donor_uid, deferral_type, deferral_reason, deferral_date, retest_date, referred_to, disease } = req.body;

        const donorResult = await client.query(
            `SELECT donor_id FROM donors WHERE donor_uid = $1`,
            [donor_uid]
        );
        if (donorResult.rows.length === 0) {
            return res.status(404).json({ error: 'Donor not found' });
        }
        const donor_id = donorResult.rows[0].donor_id;

        // Check if donor already has active deferral
        const existing = await client.query(`
            SELECT * FROM deferrals 
            WHERE donor_id = $1 AND is_reinstated = FALSE
        `, [donor_id]);

        if (existing.rows.length > 0) {
            // Update existing deferral
            const result = await client.query(`
                UPDATE deferrals 
                SET deferral_type = $1, deferral_reason = $2, deferral_date = $3, 
                    retest_date = $4, referred_to = $5, updated_at = CURRENT_TIMESTAMP
                WHERE deferral_id = $6
                RETURNING *
            `, [deferral_type, deferral_reason, deferral_date, retest_date, referred_to, existing.rows[0].deferral_id]);
            
            res.json(result.rows[0]);
        } else {
            // Insert new deferral
            const result = await client.query(`
                INSERT INTO deferrals (donor_id, deferral_type, deferral_reason, deferral_date, retest_date, referred_to)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [donor_id, deferral_type, deferral_reason, deferral_date, retest_date, referred_to]);

            // Log to algorithm log
            await client.query(`
                INSERT INTO algorithm_log (donor_id, step_name, action_taken, result)
                VALUES ($1, 'Deferral', $2, $3)
            `, [donor_id, `Donor ${deferral_type} deferred`, deferral_reason]);

            res.status(201).json(result.rows[0]);
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// ─── PUT reinstate donor ───
router.put('/:id/reinstate', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            UPDATE deferrals 
            SET is_reinstated = TRUE, reinstated_date = CURRENT_DATE
            WHERE deferral_id = $1
            RETURNING *
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Deferral not found' });
        }

        // Update donor status
        const donorId = result.rows[0].donor_id;
        await pool.query(`
            UPDATE donors 
            SET status = 'Reinstated',
                updated_at = CURRENT_TIMESTAMP
            WHERE donor_id = $1
        `, [donorId]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;