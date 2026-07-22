const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─── GET all donors with disease status ───
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                d.donor_id,
                d.donor_uid,
                d.first_name || ' ' || d.last_name AS full_name,
                d.blood_group,
                d.phone,
                d.email,
                d.nic,
                d.passport,
                d.donor_type,
                d.registration_status,
                d.last_donation,
                d.last_screening_date,
                d.is_eligible,
                d.created_at AS registered_at,
                
                -- HIV Status
                (SELECT result FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 1 
                 ORDER BY result_date DESC LIMIT 1) AS hiv_status,
                (SELECT phase_name FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 1 
                 ORDER BY result_date DESC LIMIT 1) AS hiv_phase,
                (SELECT agency_name FROM donor_disease_tests ddt 
                 JOIN agencies a ON ddt.agency_id = a.agency_id 
                 WHERE ddt.donor_id = d.donor_id AND ddt.disease_id = 1 
                 ORDER BY ddt.result_date DESC LIMIT 1) AS hiv_agency,
                
                -- HBV Status
                (SELECT result FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 2 
                 ORDER BY result_date DESC LIMIT 1) AS hbv_status,
                (SELECT phase_name FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 2 
                 ORDER BY result_date DESC LIMIT 1) AS hbv_phase,
                (SELECT agency_name FROM donor_disease_tests ddt 
                 JOIN agencies a ON ddt.agency_id = a.agency_id 
                 WHERE ddt.donor_id = d.donor_id AND ddt.disease_id = 2 
                 ORDER BY ddt.result_date DESC LIMIT 1) AS hbv_agency,
                
                -- HCV Status
                (SELECT result FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 3 
                 ORDER BY result_date DESC LIMIT 1) AS hcv_status,
                (SELECT phase_name FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 3 
                 ORDER BY result_date DESC LIMIT 1) AS hcv_phase,
                (SELECT agency_name FROM donor_disease_tests ddt 
                 JOIN agencies a ON ddt.agency_id = a.agency_id 
                 WHERE ddt.donor_id = d.donor_id AND ddt.disease_id = 3 
                 ORDER BY ddt.result_date DESC LIMIT 1) AS hcv_agency,
                
                -- Syphilis Status
                (SELECT result FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 4 
                 ORDER BY result_date DESC LIMIT 1) AS syphilis_status,
                (SELECT phase_name FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 4 
                 ORDER BY result_date DESC LIMIT 1) AS syphilis_phase,
                (SELECT agency_name FROM donor_disease_tests ddt 
                 JOIN agencies a ON ddt.agency_id = a.agency_id 
                 WHERE ddt.donor_id = d.donor_id AND ddt.disease_id = 4 
                 ORDER BY ddt.result_date DESC LIMIT 1) AS syphilis_agency,
                
                -- Malaria Status
                (SELECT result FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 5 
                 ORDER BY result_date DESC LIMIT 1) AS malaria_status,
                (SELECT phase_name FROM donor_disease_tests 
                 WHERE donor_id = d.donor_id AND disease_id = 5 
                 ORDER BY result_date DESC LIMIT 1) AS malaria_phase,
                (SELECT agency_name FROM donor_disease_tests ddt 
                 JOIN agencies a ON ddt.agency_id = a.agency_id 
                 WHERE ddt.donor_id = d.donor_id AND ddt.disease_id = 5 
                 ORDER BY ddt.result_date DESC LIMIT 1) AS malaria_agency,
                
                -- CALCULATED OVERALL STATUS
                CASE
                    WHEN EXISTS (SELECT 1 FROM donor_disease_tests 
                                 WHERE donor_id = d.donor_id AND disease_id = 1 
                                 AND result IN ('Reactive', 'Positive')) 
                        THEN 'HIV Positive - Refer to NSACP'
                    
                    WHEN EXISTS (SELECT 1 FROM donor_disease_tests 
                                 WHERE donor_id = d.donor_id AND disease_id IN (2,3) 
                                 AND result = 'Detected') 
                        THEN 'Hepatitis Positive - Refer to Virology'
                    
                    WHEN EXISTS (SELECT 1 FROM donor_disease_tests 
                                 WHERE donor_id = d.donor_id AND disease_id IN (2,3) 
                                 AND result = 'Indeterminate') 
                        THEN 'Hepatitis Indeterminate - 1 Year Deferral'
                    
                    WHEN EXISTS (SELECT 1 FROM donor_disease_tests 
                                 WHERE donor_id = d.donor_id AND disease_id = 4 
                                 AND result = 'Reactive') 
                        THEN 'Syphilis Positive - Refer to STD Clinic'
                    
                    WHEN EXISTS (SELECT 1 FROM donor_disease_tests 
                                 WHERE donor_id = d.donor_id AND disease_id = 5 
                                 AND result = 'Detected') 
                        THEN 'Malaria Positive - Refer to Anti-Malaria Campaign'
                    
                    WHEN EXISTS (SELECT 1 FROM donor_disease_tests 
                                 WHERE donor_id = d.donor_id 
                                 AND result IN ('Reactive', 'Positive', 'Detected', 'Indeterminate'))
                        THEN 'Under Review'
                    
                    ELSE 'Eligible Donor'
                END AS overall_status,
                
                -- Deferral info
                (SELECT deferral_type FROM deferrals 
                 WHERE donor_id = d.donor_id AND is_reinstated = FALSE 
                 ORDER BY deferral_date DESC LIMIT 1) AS deferral_type,
                (SELECT deferral_reason FROM deferrals 
                 WHERE donor_id = d.donor_id AND is_reinstated = FALSE 
                 ORDER BY deferral_date DESC LIMIT 1) AS deferral_reason,
                (SELECT retest_date FROM deferrals 
                 WHERE donor_id = d.donor_id AND is_reinstated = FALSE 
                 ORDER BY deferral_date DESC LIMIT 1) AS retest_date,
                
                -- Count of tests
                (SELECT COUNT(*) FROM donor_disease_tests WHERE donor_id = d.donor_id) AS total_tests,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE donor_id = d.donor_id AND result IN ('Reactive', 'Positive', 'Detected')) AS reactive_tests
                
            FROM donors d
            ORDER BY d.donor_id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching donors:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── SEARCH donors by multiple criteria ───
// IMPORTANT: This MUST come BEFORE the /:id route
router.get('/search', async (req, res) => {
    try {
        const { nic, phone, name, donor_uid, passport } = req.query;
        
        let query = `
            SELECT 
                d.*,
                CASE 
                    WHEN EXISTS (SELECT 1 FROM donor_disease_tests WHERE donor_id = d.donor_id AND result IN ('Reactive', 'Positive', 'Detected')) 
                    THEN 'Has Reactive Tests - Check Details'
                    WHEN EXISTS (SELECT 1 FROM deferrals WHERE donor_id = d.donor_id AND is_reinstated = FALSE) 
                    THEN 'Deferred - Cannot Donate'
                    ELSE 'Eligible - Can Donate'
                END AS screening_recommendation,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE donor_id = d.donor_id) AS test_count,
                (SELECT COUNT(*) FROM deferrals WHERE donor_id = d.donor_id AND is_reinstated = FALSE) AS active_deferrals,
                (SELECT COUNT(*) FROM donor_disease_tests WHERE donor_id = d.donor_id AND result IN ('Reactive', 'Positive', 'Detected')) AS reactive_tests
            FROM donors d
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 1;
        
        if (nic) {
            query += ` AND d.nic = $${paramCount}`;
            params.push(nic);
            paramCount++;
        }
        if (passport) {
            query += ` AND d.passport = $${paramCount}`;
            params.push(passport);
            paramCount++;
        }
        if (phone) {
            query += ` AND d.phone = $${paramCount}`;
            params.push(phone);
            paramCount++;
        }
        if (donor_uid) {
            query += ` AND d.donor_uid = $${paramCount}`;
            params.push(donor_uid);
            paramCount++;
        }
        if (name) {
            query += ` AND (d.first_name ILIKE $${paramCount} OR d.last_name ILIKE $${paramCount} OR d.first_name || ' ' || d.last_name ILIKE $${paramCount})`;
            params.push(`%${name}%`);
            paramCount++;
        }
        
        query += ` ORDER BY d.created_at DESC LIMIT 50`;
        
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            return res.json({ 
                found: false, 
                message: 'No donor found matching the criteria',
                recommendation: 'This appears to be a new donor. Proceed with registration.'
            });
        }
        
        // Check if donor is eligible
        const donor = result.rows[0];
        let eligibility = {
            can_donate: true,
            reason: null
        };
        
        // Check for active deferrals
        if (donor.active_deferrals > 0) {
            eligibility.can_donate = false;
            const deferral = await pool.query(`
                SELECT * FROM deferrals 
                WHERE donor_id = $1 AND is_reinstated = FALSE 
                ORDER BY deferral_date DESC LIMIT 1
            `, [donor.donor_id]);
            
            if (deferral.rows.length > 0) {
                eligibility.reason = `Deferred (${deferral.rows[0].deferral_type}) - ${deferral.rows[0].deferral_reason}`;
            }
        }
        
        // Check for reactive tests
        if (donor.reactive_tests > 0) {
            eligibility.can_donate = false;
            eligibility.reason = eligibility.reason ? 
                `${eligibility.reason}. Has ${donor.reactive_tests} reactive test(s).` : 
                `Has ${donor.reactive_tests} reactive test(s) - needs further evaluation.`;
        }
        
        // Check overall status for deferral keywords
        const overallStatus = donor.overall_status || '';
        if (overallStatus.includes('Deferred') || overallStatus.includes('Positive')) {
            eligibility.can_donate = false;
            if (!eligibility.reason) {
                eligibility.reason = overallStatus;
            }
        }
        
        res.json({
            found: true,
            donor: donor,
            eligibility: eligibility,
            recommendation: eligibility.can_donate ? 
                '✅ Donor is eligible - Proceed with donation' : 
                `🚫 Donor is NOT eligible - ${eligibility.reason}`,
            history_summary: {
                total_tests: donor.test_count || 0,
                active_deferrals: donor.active_deferrals || 0,
                reactive_tests: donor.reactive_tests || 0,
                last_donation: donor.last_donation || null
            }
        });
    } catch (err) {
        console.error('Error searching donors:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET single donor ───
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT * FROM donors WHERE donor_uid = $1 OR donor_id::text = $1
        `, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Donor not found' });
        }
        
        // Get disease tests for this donor
        const tests = await pool.query(`
            SELECT 
                ddt.*,
                di.disease_name,
                di.disease_code,
                a.agency_name,
                a.agency_type
            FROM donor_disease_tests ddt
            JOIN diseases di ON ddt.disease_id = di.disease_id
            LEFT JOIN agencies a ON ddt.agency_id = a.agency_id
            WHERE ddt.donor_id = $1
            ORDER BY ddt.result_date DESC
        `, [result.rows[0].donor_id]);
        
        // Get deferrals
        const deferrals = await pool.query(`
            SELECT * FROM deferrals 
            WHERE donor_id = $1 
            ORDER BY deferral_date DESC
        `, [result.rows[0].donor_id]);
        
        // Get donations
        const donations = await pool.query(`
            SELECT * FROM donations 
            WHERE donor_id = $1 
            ORDER BY donation_date DESC
        `, [result.rows[0].donor_id]);
        
        // Get algorithm log
        const log = await pool.query(`
            SELECT * FROM algorithm_log 
            WHERE donor_id = $1 
            ORDER BY performed_at DESC
            LIMIT 20
        `, [result.rows[0].donor_id]);
        
        res.json({
            donor: result.rows[0],
            disease_tests: tests.rows,
            deferrals: deferrals.rows,
            donations: donations.rows,
            algorithm_log: log.rows
        });
    } catch (err) {
        console.error('Error fetching donor:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET donor full history ───
router.get('/:id/history', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get donor basic info
        const donorResult = await pool.query(`
            SELECT * FROM donors WHERE donor_uid = $1 OR donor_id::text = $1
        `, [id]);
        
        if (donorResult.rows.length === 0) {
            return res.status(404).json({ error: 'Donor not found' });
        }
        const donor = donorResult.rows[0];
        
        // Get all test history
        const tests = await pool.query(`
            SELECT 
                ddt.*,
                di.disease_name,
                di.disease_code,
                a.agency_name,
                a.agency_type
            FROM donor_disease_tests ddt
            JOIN diseases di ON ddt.disease_id = di.disease_id
            LEFT JOIN agencies a ON ddt.agency_id = a.agency_id
            WHERE ddt.donor_id = $1
            ORDER BY ddt.result_date DESC
        `, [donor.donor_id]);
        
        // Get all deferrals
        const deferrals = await pool.query(`
            SELECT * FROM deferrals 
            WHERE donor_id = $1 
            ORDER BY deferral_date DESC
        `, [donor.donor_id]);
        
        // Get all donations
        const donations = await pool.query(`
            SELECT * FROM donations 
            WHERE donor_id = $1 
            ORDER BY donation_date DESC
        `, [donor.donor_id]);
        
        // Get algorithm log
        const log = await pool.query(`
            SELECT * FROM algorithm_log 
            WHERE donor_id = $1 
            ORDER BY performed_at DESC
            LIMIT 20
        `, [donor.donor_id]);
        
        // Calculate summary
        const summary = {
            total_donations: donations.rows.length,
            total_tests: tests.rows.length,
            total_deferrals: deferrals.rows.length,
            active_deferrals: deferrals.rows.filter(d => !d.is_reinstated).length,
            last_donation: donations.rows[0]?.donation_date || null,
            reactive_tests: tests.rows.filter(t => ['Reactive', 'Positive', 'Detected'].includes(t.result)).length,
            first_donation: donations.rows[donations.rows.length - 1]?.donation_date || null
        };
        
        res.json({
            donor: donor,
            summary: summary,
            tests: tests.rows,
            deferrals: deferrals.rows,
            donations: donations.rows,
            algorithm_log: log.rows
        });
    } catch (err) {
        console.error('Error fetching donor history:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── POST create new donor ───
router.post('/', async (req, res) => {
    try {
        const { 
            first_name, 
            last_name, 
            date_of_birth, 
            gender, 
            blood_group, 
            phone, 
            email, 
            address, 
            city, 
            state, 
            pincode,
            nic,
            passport,
            donor_type
        } = req.body;

        // Validate required fields
        if (!first_name || !last_name || !date_of_birth || !phone) {
            return res.status(400).json({ 
                error: 'First name, last name, date of birth, and phone are required' 
            });
        }
        
        // Generate unique donor ID
        const uidResult = await pool.query(`
            SELECT generate_donor_uid() AS new_uid
        `);
        const donor_uid = uidResult.rows[0].new_uid;
        
        const result = await pool.query(`
            INSERT INTO donors (
                donor_uid, 
                first_name, 
                last_name, 
                date_of_birth, 
                gender, 
                blood_group, 
                phone, 
                email, 
                address, 
                city, 
                state, 
                pincode,
                nic,
                passport,
                donor_type,
                is_eligible
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING *
        `, [
            donor_uid, 
            first_name, 
            last_name, 
            date_of_birth, 
            gender || null, 
            blood_group || null, 
            phone, 
            email || null, 
            address || null, 
            city || null, 
            state || null, 
            pincode || null,
            nic || null,
            passport || null,
            donor_type || 'Regular',
            true
        ]);
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating donor:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── PUT update donor ───
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            first_name, 
            last_name, 
            phone, 
            email, 
            address, 
            city, 
            state, 
            pincode, 
            registration_status,
            nic,
            passport,
            donor_type,
            is_eligible
        } = req.body;
        
        const result = await pool.query(`
            UPDATE donors 
            SET 
                first_name = COALESCE($1, first_name),
                last_name = COALESCE($2, last_name),
                phone = COALESCE($3, phone),
                email = COALESCE($4, email),
                address = COALESCE($5, address),
                city = COALESCE($6, city),
                state = COALESCE($7, state),
                pincode = COALESCE($8, pincode),
                registration_status = COALESCE($9, registration_status),
                nic = COALESCE($10, nic),
                passport = COALESCE($11, passport),
                donor_type = COALESCE($12, donor_type),
                is_eligible = COALESCE($13, is_eligible),
                updated_at = CURRENT_TIMESTAMP
            WHERE donor_uid = $14 OR donor_id::text = $14
            RETURNING *
        `, [
            first_name, 
            last_name, 
            phone, 
            email, 
            address, 
            city, 
            state, 
            pincode, 
            registration_status,
            nic,
            passport,
            donor_type,
            is_eligible,
            id
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Donor not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating donor:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── UPDATE donor eligibility ───
router.patch('/:id/eligibility', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_eligible, reason } = req.body;
        
        const result = await pool.query(`
            UPDATE donors 
            SET 
                is_eligible = $1,
                last_screening_date = CURRENT_DATE,
                updated_at = CURRENT_TIMESTAMP
            WHERE donor_uid = $2 OR donor_id::text = $2
            RETURNING *
        `, [is_eligible, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Donor not found' });
        }
        
        // Log the eligibility change
        await pool.query(`
            INSERT INTO algorithm_log (donor_id, step_name, action_taken, result)
            VALUES ($1, 'Eligibility Update', $2, $3)
        `, [result.rows[0].donor_id, reason || 'Eligibility status changed', is_eligible ? 'Eligible' : 'Not Eligible']);
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating eligibility:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;