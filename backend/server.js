const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();

// Import routes
const donorRoutes = require('./routes/donors');
const testRoutes = require('./routes/tests');
const deferralRoutes = require('./routes/deferrals');
const agencyRoutes = require('./routes/agencies');
const diseaseRoutes = require('./routes/diseases');
const syncRoutes = require('./routes/sync');
const statsRoutes = require('./routes/stats');
const authRoutes = require('./routes/auth');
const counsellingRoutes = require('./routes/counselling');
const { authenticate, authorize } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// ─── PUBLIC ROUTES (No Auth Required) ───
app.use('/api/auth', authRoutes);

// ─── PROTECTED ROUTES ───
app.use('/api/donors', authenticate, donorRoutes);
app.use('/api/tests', authenticate, testRoutes);
app.use('/api/deferrals', authenticate, deferralRoutes);
app.use('/api/agencies', authenticate, agencyRoutes);
app.use('/api/diseases', authenticate, diseaseRoutes);
app.use('/api/stats', authenticate, statsRoutes);
app.use('/api/counselling', authenticate, counsellingRoutes.router);

// ─── SYNC ROUTES (Admin Only) ───
app.use('/api/sync', authenticate, authorize('admin'), syncRoutes);

// ─── HEALTH CHECK (Public) ───
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Multi-Disease Blood Bank API is running',
        version: '2.1.0',
        timestamp: new Date().toISOString(),
        features: {
            diseases: ['HIV', 'HBV', 'HCV', 'Syphilis', 'Malaria'],
            agencies: true,
            webhooks: true,
            counselling: true,
            auth: true
        }
    });
});

// ─── DISEASE STATUS ENDPOINT ───
app.get('/api/disease-status', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                d.donor_uid,
                d.first_name || ' ' || d.last_name AS full_name,
                (SELECT result FROM donor_disease_tests WHERE donor_id = d.donor_id AND disease_id = 1 ORDER BY result_date DESC LIMIT 1) AS hiv_status,
                (SELECT result FROM donor_disease_tests WHERE donor_id = d.donor_id AND disease_id = 2 ORDER BY result_date DESC LIMIT 1) AS hbv_status,
                (SELECT result FROM donor_disease_tests WHERE donor_id = d.donor_id AND disease_id = 3 ORDER BY result_date DESC LIMIT 1) AS hcv_status,
                (SELECT result FROM donor_disease_tests WHERE donor_id = d.donor_id AND disease_id = 4 ORDER BY result_date DESC LIMIT 1) AS syphilis_status,
                (SELECT result FROM donor_disease_tests WHERE donor_id = d.donor_id AND disease_id = 5 ORDER BY result_date DESC LIMIT 1) AS malaria_status,
                d.status AS overall_status
            FROM donors d
            ORDER BY d.donor_id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching disease status:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================
// WEBHOOK ENDPOINTS - AUTO RECEIVE DATA FROM AGENCIES
// ============================================================

// ─── WEBHOOK: Receive single test result from agency ───
app.post('/api/webhook/test-result', async (req, res) => {
    const client = await pool.connect();
    try {
        const data = req.body;
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

        if (!apiKey) {
            return res.status(401).json({ 
                success: false, 
                error: 'API key required' 
            });
        }

        const agencyResult = await client.query(
            `SELECT agency_id, agency_name FROM agencies WHERE api_key = $1 AND is_active = TRUE`,
            [apiKey]
        );

        if (agencyResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid or inactive API key' 
            });
        }

        const agency = agencyResult.rows[0];
        const required = ['donor_uid', 'disease', 'result'];
        for (const field of required) {
            if (!data[field]) {
                return res.status(400).json({ 
                    success: false, 
                    error: `Missing required field: ${field}` 
                });
            }
        }

        const donorResult = await client.query(
            `SELECT donor_id FROM donors WHERE donor_uid = $1`,
            [data.donor_uid]
        );

        if (donorResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: `Donor ${data.donor_uid} not found` 
            });
        }

        const donor_id = donorResult.rows[0].donor_id;
        const diseaseResult = await client.query(
            `SELECT disease_id FROM diseases WHERE disease_code = $1 OR disease_name ILIKE $1`,
            [data.disease]
        );

        if (diseaseResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: `Disease ${data.disease} not found` 
            });
        }

        const disease_id = diseaseResult.rows[0].disease_id;
        const phaseMap = {
            'initial': 1,
            'screening': 1,
            'duplicate': 1,
            'confirmatory': 2,
            'confirmation': 2,
            'molecular': 3,
            'pcr': 3,
            'final': 3
        };

        const phase = data.phase || 'Initial';
        const phaseNum = phaseMap[phase.toLowerCase()] || 1;
        const phaseName = data.phase_name || phase;

        const testResult = await client.query(`
            INSERT INTO donor_disease_tests (
                donor_id, disease_id, phase, phase_name,
                test_method, agency_id, result, 
                result_date, notes, performed_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            donor_id,
            disease_id,
            phaseNum,
            phaseName,
            data.method || 'Standard',
            agency.agency_id,
            data.result,
            data.test_date || new Date(),
            data.notes || `Received from ${agency.agency_name}`,
            data.performed_by || agency.agency_name
        ]);

        await client.query(`
            INSERT INTO algorithm_log (
                donor_id, step_name, action_taken, result, performed_by
            )
            VALUES ($1, $2, $3, $4, $5)
        `, [
            donor_id,
            `Webhook - ${data.disease}`,
            `Test result received from ${agency.agency_name}`,
            data.result,
            'System (Webhook)'
        ]);

        const statusResult = await recalculateDonorStatus(client, donor_id);
        await checkAndCreateDeferral(client, donor_id, data.disease, data.result);

        const positiveResults = ['Reactive', 'Positive', 'Detected'];
        if (positiveResults.includes(data.result)) {
            await triggerCounselling(client, donor_id, data.disease, data.result);
            console.log(`🧠 Counselling triggered for donor ${data.donor_uid}`);
        }

        res.status(200).json({
            success: true,
            message: 'Test result received and processed',
            donor_uid: data.donor_uid,
            disease: data.disease,
            result: data.result,
            new_status: statusResult?.overall_status || 'Updated',
            counselling_triggered: positiveResults.includes(data.result),
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Webhook error:', err);
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    } finally {
        client.release();
    }
});

// ─── WEBHOOK: Bulk sync from agency ───
app.post('/api/webhook/bulk-sync', async (req, res) => {
    const client = await pool.connect();
    try {
        const { agency_code, donors } = req.body;
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

        if (!apiKey) {
            return res.status(401).json({ 
                success: false, 
                error: 'API key required' 
            });
        }

        const agencyResult = await client.query(
            `SELECT agency_id, agency_name FROM agencies WHERE api_key = $1 AND is_active = TRUE`,
            [apiKey]
        );

        if (agencyResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid API key' 
            });
        }

        const agency = agencyResult.rows[0];
        let processed = 0;
        let errors = [];

        for (const donor of donors) {
            try {
                let donorId;
                const existing = await client.query(
                    `SELECT donor_id FROM donors WHERE donor_uid = $1`,
                    [donor.donor_uid]
                );

                if (existing.rows.length === 0) {
                    const newDonor = await client.query(`
                        INSERT INTO donors (
                            donor_uid, first_name, last_name, date_of_birth,
                            gender, blood_group, phone, email, nic, donor_type
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        RETURNING donor_id
                    `, [
                        donor.donor_uid,
                        donor.first_name || 'Unknown',
                        donor.last_name || 'Donor',
                        donor.date_of_birth || '2000-01-01',
                        donor.gender || 'Other',
                        donor.blood_group || 'O+',
                        donor.phone || '0000000000',
                        donor.email || null,
                        donor.nic || null,
                        donor.donor_type || 'Regular'
                    ]);
                    donorId = newDonor.rows[0].donor_id;
                } else {
                    donorId = existing.rows[0].donor_id;
                }

                if (donor.tests && donor.tests.length > 0) {
                    for (const test of donor.tests) {
                        await client.query(`
                            INSERT INTO donor_disease_tests (
                                donor_id, disease_id, phase, phase_name,
                                test_method, agency_id, result, result_date
                            )
                            SELECT 
                                $1, d.disease_id, $2, $3,
                                $4, $5, $6, $7
                            FROM diseases d
                            WHERE d.disease_code = $8
                        `, [
                            donorId,
                            test.phase || 1,
                            test.phase_name || 'Initial',
                            test.method || 'Standard',
                            agency.agency_id,
                            test.result,
                            test.test_date || new Date(),
                            test.disease
                        ]);
                        processed++;
                    }
                    await recalculateDonorStatus(client, donorId);
                }

            } catch (err) {
                errors.push({
                    donor_uid: donor.donor_uid,
                    error: err.message
                });
            }
        }

        res.status(200).json({
            success: true,
            message: `Processed ${processed} test results from ${agency.agency_name}`,
            processed: processed,
            errors: errors,
            agency: agency.agency_name
        });

    } catch (err) {
        console.error('Bulk sync error:', err);
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    } finally {
        client.release();
    }
});

// ─── WEBHOOK: Receive deferral from agency ───
app.post('/api/webhook/deferral', async (req, res) => {
    const client = await pool.connect();
    try {
        const data = req.body;
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

        if (!apiKey) {
            return res.status(401).json({ 
                success: false, 
                error: 'API key required' 
            });
        }

        const agencyResult = await client.query(
            `SELECT agency_id, agency_name FROM agencies WHERE api_key = $1 AND is_active = TRUE`,
            [apiKey]
        );

        if (agencyResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid API key' 
            });
        }

        const agency = agencyResult.rows[0];
        const donorResult = await client.query(
            `SELECT donor_id FROM donors WHERE donor_uid = $1`,
            [data.donor_uid]
        );

        if (donorResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: `Donor ${data.donor_uid} not found` 
            });
        }

        const donor_id = donorResult.rows[0].donor_id;

        const deferralResult = await client.query(`
            INSERT INTO deferrals (
                donor_id, deferral_type, deferral_reason, 
                deferral_date, retest_date, referred_to, disease_id
            )
            SELECT 
                $1, $2, $3, $4, $5, $6, d.disease_id
            FROM diseases d
            WHERE d.disease_code = $7
            RETURNING *
        `, [
            donor_id,
            data.deferral_type || 'Permanent',
            data.reason || 'Deferred based on test results',
            data.deferral_date || new Date(),
            data.retest_date || null,
            data.referred_to || null,
            data.disease || null
        ]);

        await client.query(`
            INSERT INTO algorithm_log (
                donor_id, step_name, action_taken, result, performed_by
            )
            VALUES ($1, $2, $3, $4, $5)
        `, [
            donor_id,
            'Webhook - Deferral',
            `Deferral received from ${agency.agency_name}`,
            `${data.deferral_type || 'Permanent'} - ${data.reason || 'No reason provided'}`,
            'System (Webhook)'
        ]);

        await recalculateDonorStatus(client, donor_id);
        await triggerCounselling(client, donor_id, data.disease || 'Unknown', 'Deferred');

        res.status(200).json({
            success: true,
            message: 'Deferral received and processed',
            donor_uid: data.donor_uid,
            deferral: deferralResult.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Deferral webhook error:', err);
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    } finally {
        client.release();
    }
});

// ─── HELPER: Recalculate donor status ───
async function recalculateDonorStatus(client, donor_id) {
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

    const hasReactive = statuses.rows.some(s => 
        ['Reactive', 'Positive', 'Detected'].includes(s.result)
    );

    if (statuses.rows.length > 0 && !hasReactive && overallStatus === 'Eligible Donor') {
        overallStatus = 'Eligible Donor';
    }

    await client.query(`
        UPDATE donors 
        SET status = $1, 
            status_details = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE donor_id = $3
    `, [overallStatus, JSON.stringify(statusDetails), donor_id]);

    console.log(`🔄 Donor ${donor_id} status updated to: ${overallStatus}`);

    return { overall_status: overallStatus, status_details: statusDetails };
}

// ─── HELPER: Check and create deferral if needed ───
async function checkAndCreateDeferral(client, donor_id, disease, result) {
    const existing = await client.query(`
        SELECT * FROM deferrals 
        WHERE donor_id = $1 AND is_reinstated = FALSE
    `, [donor_id]);

    if (existing.rows.length > 0) {
        return;
    }

    const deferralTriggers = {
        'HIV': ['Reactive', 'Positive'],
        'HBV': ['Detected'],
        'HCV': ['Detected'],
        'Syphilis': ['Reactive'],
        'Malaria': ['Detected']
    };

    const diseaseCode = disease.toUpperCase();
    if (deferralTriggers[diseaseCode] && deferralTriggers[diseaseCode].includes(result)) {
        const deferralType = diseaseCode === 'HIV' ? 'Permanent' : 'Temporary';
        const retestDate = deferralType === 'Temporary' ? 
            new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null;

        const diseaseResult = await client.query(
            `SELECT disease_id FROM diseases WHERE disease_code = $1`,
            [diseaseCode]
        );

        const disease_id = diseaseResult.rows[0]?.disease_id || null;

        await client.query(`
            INSERT INTO deferrals (
                donor_id, deferral_type, deferral_reason, 
                deferral_date, retest_date, disease_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            donor_id,
            deferralType,
            `${diseaseCode} ${result} - Auto-deferred by system`,
            new Date(),
            retestDate,
            disease_id
        ]);

        console.log(`🚫 Auto-deferred donor ${donor_id} - ${diseaseCode} ${result}`);
        
        await triggerCounselling(client, donor_id, diseaseCode, 'Deferred');
    }
}

// ─── 🧠 HELPER: Trigger counselling ───
async function triggerCounselling(client, donor_id, disease, result) {
    try {
        const existing = await client.query(`
            SELECT * FROM counselling_sessions 
            WHERE donor_id = $1 AND session_type IN ('Positive Result', 'Deferral')
            AND session_date >= CURRENT_DATE - INTERVAL '30 days'
            ORDER BY session_date DESC LIMIT 1
        `, [donor_id]);

        if (existing.rows.length > 0) {
            return { message: 'Counselling already exists', session: existing.rows[0] };
        }

        let sessionType = 'Positive Result';
        if (result === 'Deferred') {
            sessionType = 'Deferral';
        }

        const sessionResult = await client.query(`
            INSERT INTO counselling_sessions (donor_id, session_type, location, is_remote)
            VALUES ($1, $2, 'NBC Counselling Centre', FALSE)
            RETURNING *
        `, [donor_id, sessionType]);

        await client.query(`
            INSERT INTO counselling_reminders (donor_id, reminder_type, reminder_date)
            VALUES ($1, 'Follow-up', CURRENT_DATE + INTERVAL '7 days')
        `, [donor_id]);

        await client.query(`
            INSERT INTO algorithm_log (donor_id, step_name, action_taken, result)
            VALUES ($1, 'Counselling Trigger', $2, $3)
        `, [donor_id, `Counselling triggered for ${disease} ${result}`, 'Pending']);

        console.log(`🧠 Counselling session created for donor ${donor_id}`);

        return { message: 'Counselling triggered successfully', session: sessionResult.rows[0] };
    } catch (err) {
        console.error('Error triggering counselling:', err);
        throw err;
    }
}

// ─── START SERVER ───
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🩸 Multi-Disease Blood Bank API running on port ${PORT}`);
    console.log(`📋 Health check: /api/health`);
    console.log(`🔗 Webhook endpoints:`);
    console.log(`   POST /api/webhook/test-result - Receive single test result`);
    console.log(`   POST /api/webhook/bulk-sync - Receive bulk test results`);
    console.log(`   POST /api/webhook/deferral - Receive deferral from agency`);
    console.log(`🧠 Counselling module enabled - Auto-trigger on positive results`);
    console.log(`🔐 Authentication enabled - Protected routes require JWT token`);
});