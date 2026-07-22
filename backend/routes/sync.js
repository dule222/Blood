const express = require('express');
const router = express.Router();
const pool = require('../db');
const axios = require('axios');

// ─── SYNC from all agencies ───
router.post('/all', async (req, res) => {
    const client = await pool.connect();
    try {
        const agencies = await client.query(`
            SELECT * FROM agencies WHERE is_active = TRUE AND api_endpoint IS NOT NULL
        `);

        let syncedDonors = 0;
        const results = [];

        for (const agency of agencies.rows) {
            try {
                const response = await axios.get(`${agency.api_endpoint}/donors`, {
                    headers: {
                        'Authorization': `Bearer ${agency.api_key || process.env[`AGENCY_${agency.agency_code}_API_KEY`]}`,
                        'X-Agency-ID': agency.agency_code
                    },
                    timeout: 10000
                });

                if (response.data && response.data.donors) {
                    for (const donorData of response.data.donors) {
                        await syncDonorFromAgency(client, donorData, agency.agency_id);
                        syncedDonors++;
                    }
                    results.push({
                        agency: agency.agency_name,
                        status: 'success',
                        count: response.data.donors.length
                    });
                }
            } catch (error) {
                results.push({
                    agency: agency.agency_name,
                    status: 'error',
                    error: error.message
                });
                console.error(`Error syncing ${agency.agency_name}:`, error.message);
            }
        }

        res.json({
            message: 'Sync completed',
            synced_donors: syncedDonors,
            agencies: results
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// ─── SYNC from specific agency ───
router.post('/agency/:code', async (req, res) => {
    const client = await pool.connect();
    try {
        const { code } = req.params;
        const agency = await client.query(`
            SELECT * FROM agencies WHERE agency_code = $1 AND is_active = TRUE
        `, [code]);

        if (agency.rows.length === 0) {
            return res.status(404).json({ error: 'Agency not found' });
        }

        const agencyData = agency.rows[0];
        let synced = 0;

        try {
            const response = await axios.get(`${agencyData.api_endpoint}/donors`, {
                headers: {
                    'Authorization': `Bearer ${agencyData.api_key}`,
                    'X-Agency-ID': agencyData.agency_code
                },
                timeout: 10000
            });

            if (response.data && response.data.donors) {
                for (const donorData of response.data.donors) {
                    await syncDonorFromAgency(client, donorData, agencyData.agency_id);
                    synced++;
                }
            }

            res.json({
                message: `Synced ${synced} donors from ${agencyData.agency_name}`,
                agency: agencyData.agency_name,
                synced: synced
            });
        } catch (error) {
            res.status(500).json({
                error: `Failed to sync ${agencyData.agency_name}`,
                details: error.message
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// ─── Helper: Sync a single donor from agency ───
async function syncDonorFromAgency(client, donorData, agencyId) {
    // Check if donor exists
    const existing = await client.query(
        `SELECT donor_id FROM donors WHERE donor_uid = $1`,
        [donorData.donor_uid]
    );

    let donorId;

    if (existing.rows.length === 0) {
        // Create donor
        const result = await client.query(`
            INSERT INTO donors (donor_uid, first_name, last_name, date_of_birth, gender, blood_group, phone, email, address)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING donor_id
        `, [
            donorData.donor_uid,
            donorData.first_name,
            donorData.last_name,
            donorData.date_of_birth,
            donorData.gender || 'Other',
            donorData.blood_group,
            donorData.phone,
            donorData.email,
            donorData.address
        ]);
        donorId = result.rows[0].donor_id;
    } else {
        donorId = existing.rows[0].donor_id;
    }

    // Sync disease tests
    if (donorData.tests && donorData.tests.length > 0) {
        for (const test of donorData.tests) {
            await client.query(`
                INSERT INTO donor_disease_tests (donor_id, disease_id, phase, phase_name, test_method, agency_id, result, notes)
                SELECT $1, d.disease_id, $3, $4, $5, $6, $7, $8
                FROM diseases d
                WHERE d.disease_code = $2
            `, [
                donorId,
                test.disease_code,
                test.phase || 1,
                test.phase_name || 'Initial',
                test.test_method || 'Standard',
                agencyId,
                test.result,
                `Synced from agency ${agencyId}`
            ]);
        }
    }

    return donorId;
}

module.exports = router;