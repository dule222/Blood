const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─── GET all tests ───
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                ddt.*,
                d.donor_uid,
                d.first_name || ' ' || d.last_name AS donor_name,
                di.disease_name,
                di.disease_code,
                a.agency_name
            FROM donor_disease_tests ddt
            JOIN donors d ON ddt.donor_id = d.donor_id
            JOIN diseases di ON ddt.disease_id = di.disease_id
            LEFT JOIN agencies a ON ddt.agency_id = a.agency_id
            ORDER BY ddt.result_date DESC
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET tests for a specific donor ───
router.get('/donor/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT 
                ddt.*,
                di.disease_name,
                di.disease_code,
                a.agency_name
            FROM donor_disease_tests ddt
            JOIN diseases di ON ddt.disease_id = di.disease_id
            LEFT JOIN agencies a ON ddt.agency_id = a.agency_id
            WHERE ddt.donor_id = (SELECT donor_id FROM donors WHERE donor_uid = $1 OR donor_id::text = $1)
            ORDER BY ddt.result_date DESC
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── POST enter test result ───
router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { 
            donor_uid, 
            disease, 
            phase, 
            method, 
            agency, 
            result, 
            next_action,
            notes 
        } = req.body;

        // Get donor_id
        const donorResult = await client.query(
            `SELECT donor_id FROM donors WHERE donor_uid = $1`,
            [donor_uid]
        );
        if (donorResult.rows.length === 0) {
            return res.status(404).json({ error: 'Donor not found' });
        }
        const donor_id = donorResult.rows[0].donor_id;

        // Get disease_id
        const diseaseResult = await client.query(
            `SELECT disease_id FROM diseases WHERE disease_name = $1 OR disease_code = $1`,
            [disease]
        );
        if (diseaseResult.rows.length === 0) {
            return res.status(404).json({ error: 'Disease not found' });
        }
        const disease_id = diseaseResult.rows[0].disease_id;

        // Get agency_id
        let agency_id = null;
        if (agency) {
            const agencyResult = await client.query(
                `SELECT agency_id FROM agencies WHERE agency_name = $1 OR agency_code = $1`,
                [agency]
            );
            if (agencyResult.rows.length > 0) {
                agency_id = agencyResult.rows[0].agency_id;
            }
        }

        // Determine phase number
        let phase_num = 1;
        if (phase.toLowerCase().includes('confirmatory')) phase_num = 2;
        else if (phase.toLowerCase().includes('final')) phase_num = 3;

        // Insert test result
        const testResult = await client.query(`
            INSERT INTO donor_disease_tests (
                donor_id, disease_id, phase, phase_name, 
                test_method, agency_id, result, notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [donor_id, disease_id, phase_num, phase, method, agency_id, result, notes]);

        // Log to algorithm log
        await client.query(`
            INSERT INTO algorithm_log (donor_id, step_name, action_taken, result)
            VALUES ($1, $2, $3, $4)
        `, [donor_id, `${disease} - ${phase}`, `Test recorded using ${method}`, result]);

        // If final phase, update overall status
        if (phase_num === 3) {
            await updateOverallStatus(client, donor_id);
        }

        res.status(201).json(testResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// ─── Helper: Update overall status ───
async function updateOverallStatus(client, donor_id) {
    // Get all disease statuses
    const statuses = await client.query(`
        SELECT 
            d.disease_code,
            ddt.result,
            ddt.phase,
            ddt.phase_name
        FROM donor_disease_tests ddt
        JOIN diseases d ON ddt.disease_id = d.disease_id
        WHERE ddt.donor_id = $1
        AND ddt.result_date = (
            SELECT MAX(result_date) 
            FROM donor_disease_tests 
            WHERE donor_id = $1 AND disease_id = ddt.disease_id
        )
    `, [donor_id]);

    let overallStatus = 'Eligible Donor';
    let statusDetails = [];

    // Priority order (HIGHEST FIRST)
    const priorityRules = [
        { disease: 'HIV', results: ['Reactive', 'Positive'], status: 'HIV Positive - Refer to NSACP' },
        { disease: 'HBV', results: ['Detected'], status: 'Hepatitis Positive - Refer to Virology' },
        { disease: 'HCV', results: ['Detected'], status: 'Hepatitis Positive - Refer to Virology' },
        { disease: 'HBV', results: ['Indeterminate'], status: 'Hepatitis Indeterminate - 1 Year Deferral' },
        { disease: 'HCV', results: ['Indeterminate'], status: 'Hepatitis Indeterminate - 1 Year Deferral' },
        { disease: 'Syphilis', results: ['Reactive'], status: 'Syphilis Positive - Refer to STD Clinic' },
        { disease: 'Malaria', results: ['Detected'], status: 'Malaria Positive - Refer to Anti-Malaria Campaign' }
    ];

    for (const rule of priorityRules) {
        const match = statuses.rows.find(s => 
            s.disease_code === rule.disease && 
            rule.results.includes(s.result)
        );
        if (match) {
            overallStatus = rule.status;
            statusDetails.push({
                disease: match.disease_code,
                result: match.result,
                phase: match.phase_name,
                status: rule.status
            });
            break;
        }
    }

    // Update donor
    await client.query(`
        UPDATE donors 
        SET status = $1, 
            status_details = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE donor_id = $3
    `, [overallStatus, JSON.stringify(statusDetails), donor_id]);

    console.log(`🔄 Donor ${donor_id} overall status updated to: ${overallStatus}`);
}

module.exports = router;