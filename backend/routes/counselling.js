const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─── GET all counselling sessions ───
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                cs.*,
                d.donor_uid,
                d.first_name || ' ' || d.last_name AS donor_name,
                u.full_name AS counsellor_name,
                cd.topic,
                cd.notes AS counselling_notes,
                cd.donor_concerns,
                cd.donor_questions,
                cd.given_advice,
                co.outcome_type,
                co.referral_to,
                co.referral_date,
                co.follow_up_date
            FROM counselling_sessions cs
            LEFT JOIN donors d ON cs.donor_id = d.donor_id
            LEFT JOIN users u ON cs.counsellor_id = u.user_id
            LEFT JOIN counselling_details cd ON cs.session_id = cd.session_id
            LEFT JOIN counselling_outcomes co ON cs.session_id = co.session_id
            ORDER BY cs.session_date DESC
            LIMIT 100
        `);
        res.json(result.rows || []);
    } catch (err) {
        console.error('Error fetching counselling sessions:', err);
        // Return empty array instead of error
        res.json([]);
    }
});

// ─── GET pending counselling tasks ───
router.get('/pending', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                d.donor_uid,
                d.first_name || ' ' || d.last_name AS donor_name,
                d.blood_group,
                d.status AS donor_status,
                cs.session_id,
                cs.session_type,
                cs.session_date,
                cs.location,
                cs.is_remote,
                COUNT(co.outcome_id) AS outcome_count
            FROM counselling_sessions cs
            JOIN donors d ON cs.donor_id = d.donor_id
            LEFT JOIN counselling_outcomes co ON cs.session_id = co.session_id
            WHERE (co.outcome_id IS NULL OR co.outcome_type NOT IN ('Completed', 'Declined'))
            GROUP BY cs.session_id, d.donor_uid, d.first_name, d.last_name, d.blood_group, d.status
            ORDER BY cs.session_date ASC
            LIMIT 50
        `);
        res.json(result.rows || []);
    } catch (err) {
        console.error('Error fetching pending counselling:', err);
        res.json([]);
    }
});

// ─── GET counselling analytics ───
router.get('/analytics', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) AS total_sessions,
                COUNT(DISTINCT cs.donor_id) AS unique_donors,
                COUNT(co.outcome_id) FILTER (WHERE co.outcome_type = 'Completed') AS completed,
                COUNT(co.outcome_id) FILTER (WHERE co.outcome_type = 'Referred') AS referred,
                COUNT(co.outcome_id) FILTER (WHERE co.outcome_type = 'Declined') AS declined,
                COUNT(co.outcome_id) FILTER (WHERE co.outcome_type = 'Lost to Follow-up') AS lost_to_followup,
                AVG(cs.duration_minutes) AS avg_duration
            FROM counselling_sessions cs
            LEFT JOIN counselling_outcomes co ON cs.session_id = co.session_id
        `);
        res.json(result.rows || []);
    } catch (err) {
        console.error('Error fetching counselling analytics:', err);
        res.json([]);
    }
});

// ─── POST create counselling session ───
router.post('/session', async (req, res) => {
    const client = await pool.connect();
    try {
        const { donor_uid, session_type, counsellor_id, location, is_remote, duration_minutes } = req.body;

        if (!donor_uid || !session_type) {
            return res.status(400).json({ error: 'Donor ID and session type are required' });
        }

        const donorResult = await client.query(
            `SELECT donor_id FROM donors WHERE donor_uid = $1`,
            [donor_uid]
        );
        if (donorResult.rows.length === 0) {
            return res.status(404).json({ error: 'Donor not found' });
        }
        const donor_id = donorResult.rows[0].donor_id;

        const result = await client.query(`
            INSERT INTO counselling_sessions (donor_id, session_type, counsellor_id, location, is_remote, duration_minutes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [donor_id, session_type, counsellor_id, location, is_remote || false, duration_minutes]);

        await client.query(`
            INSERT INTO algorithm_log (donor_id, step_name, action_taken, result)
            VALUES ($1, 'Counselling', $2, $3)
        `, [donor_id, `Counselling session created: ${session_type}`, 'Pending']);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating counselling session:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// ─── POST add counselling details ───
router.post('/details', async (req, res) => {
    try {
        const { session_id, topic, notes, donor_concerns, donor_questions, given_advice } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        const result = await pool.query(`
            INSERT INTO counselling_details (session_id, topic, notes, donor_concerns, donor_questions, given_advice)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [session_id, topic, notes, donor_concerns, donor_questions, given_advice]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding counselling details:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── POST add counselling outcome ───
router.post('/outcome', async (req, res) => {
    const client = await pool.connect();
    try {
        const { session_id, outcome_type, referral_to, referral_date, follow_up_date, notes } = req.body;

        if (!session_id || !outcome_type) {
            return res.status(400).json({ error: 'Session ID and outcome type are required' });
        }

        const result = await client.query(`
            INSERT INTO counselling_outcomes (session_id, outcome_type, referral_to, referral_date, follow_up_date, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [session_id, outcome_type, referral_to, referral_date, follow_up_date, notes]);

        if (outcome_type === 'Completed') {
            const sessionResult = await client.query(
                `SELECT donor_id FROM counselling_sessions WHERE session_id = $1`,
                [session_id]
            );
            if (sessionResult.rows.length > 0) {
                const donor_id = sessionResult.rows[0].donor_id;
                await client.query(`
                    UPDATE donors 
                    SET status = 'Counselled',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE donor_id = $1
                `, [donor_id]);
            }
        }

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding counselling outcome:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

module.exports = { router };