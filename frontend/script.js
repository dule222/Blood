// ============================================================
// MULTI-DISEASE BLOOD BANK MANAGEMENT SYSTEM — MAIN SCRIPT
// ============================================================

const API_BASE = 'http://localhost:5000/api';

// ─── STATE ───
let donors = [];
let tests = [];
let deferrals = [];
let agencies = [];
let diseaseStats = {};
let currentSearchResults = null;
let currentUser = null;

// ─── DOM REFS ───
const $ = (id) => document.getElementById(id);
const toast = $('toast');

// ─── AUTHENTICATION FUNCTIONS ───

// Get token from localStorage
function getToken() {
    return localStorage.getItem('bbms_token');
}

// Get user from localStorage
function getUser() {
    const userStr = localStorage.getItem('bbms_user');
    return userStr ? JSON.parse(userStr) : null;
}

// Check if user is logged in
function isLoggedIn() {
    return !!getToken();
}

// ─── LOGOUT ───
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('bbms_token');
        localStorage.removeItem('bbms_user');
        window.location.href = 'login.html';
    }
}

// ─── UPDATE USER DISPLAY ───
function updateUserDisplay() {
    const user = getUser();
    if (user) {
        const nameEl = document.getElementById('userName');
        const avatarEl = document.getElementById('userAvatar');
        if (nameEl) nameEl.textContent = user.full_name || user.username;
        if (avatarEl) avatarEl.textContent = (user.full_name || user.username).charAt(0).toUpperCase();
        currentUser = user;
    }
}

// ─── TOAST ───
function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// ─── API CALLS WITH AUTH ───
async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    const url = `${API_BASE}${endpoint}`;
    
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        },
        ...options,
    };
    
    try {
        const res = await fetch(url, config);
        
        // If unauthorized, redirect to login
        if (res.status === 401) {
            localStorage.removeItem('bbms_token');
            localStorage.removeItem('bbms_user');
            window.location.href = 'login.html';
            throw new Error('Session expired. Please login again.');
        }
        
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'API Error');
        }
        return data;
    } catch (err) {
        // Don't show toast for 401 (already handled)
        if (err.message !== 'Session expired. Please login again.') {
            showToast(err.message, 'error');
        }
        throw err;
    }
}

// ─── SYNC FROM AGENCIES ───
async function syncFromAgencies() {
    showToast('📡 Syncing data from all agencies...', 'warning');
    try {
        const response = await apiFetch('/sync/all', { method: 'POST' });
        showToast(`✅ Synced ${response.synced_donors || 0} donors from ${response.agencies || 0} agencies`, 'success');
        await loadDashboard();
    } catch (err) {
        console.error(err);
    }
}

// ─── LOAD DASHBOARD ───
async function loadDashboard() {
    try {
        // Load stats
        const stats = await apiFetch('/stats');
        $('statTotal').textContent = stats.total_donors || 0;
        $('statEligible').textContent = stats.eligible_donors || 0;
        $('statTemp').textContent = stats.temp_deferred || 0;
        $('statPerm').textContent = stats.perm_deferred || 0;

        // Disease stats
        $('statHIV').textContent = stats.hiv_positive || 0;
        $('statHBV').textContent = stats.hbv_positive || 0;
        $('statHCV').textContent = stats.hcv_positive || 0;
        $('statSyphilis').textContent = stats.syphilis_positive || 0;
        $('statMalaria').textContent = stats.malaria_positive || 0;

        // Load donors with disease status
        donors = await apiFetch('/donors');
        renderDonorTable(donors);
        renderDonorRegistry(donors);
        renderDiseaseStatus(donors);
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        showToast('Error loading dashboard data', 'error');
    }
}

// ─── LOAD DEFERRALS ───
async function loadDeferrals() {
    try {
        // Fetch deferrals directly from the API
        const deferralsData = await apiFetch('/deferrals');
        renderDeferralTable(deferralsData);
    } catch (err) {
        console.error('Failed to load deferrals from API:', err);
        // Fallback: try to get from donors data
        if (donors && donors.length > 0) {
            const deferred = donors.filter(d => 
                d.overall_status && (
                    d.overall_status.includes('Deferred') || 
                    d.overall_status.includes('deferred') ||
                    d.overall_status.includes('Positive')
                )
            );
            renderDeferralTable(deferred);
        }
    }
}

// ─── LOAD AGENCIES ───
async function loadAgencies() {
    try {
        agencies = await apiFetch('/agencies');
        renderAgencyTable(agencies);
    } catch (err) {
        console.error('Failed to load agencies:', err);
    }
}

// ─── LOAD DISEASE STATUS ───
// ─── LOAD DISEASE STATUS ───
async function loadDiseaseStatus() {
    try {
        // Use the donors data that's already loaded, or fetch it
        if (donors && donors.length > 0) {
            renderDiseaseStatus(donors);
        } else {
            // Fallback: fetch from API
            const diseaseData = await apiFetch('/disease-status');
            renderDiseaseStatus(diseaseData);
        }
    } catch (err) {
        console.error('Failed to load disease status:', err);
        // Use donors data if available
        if (donors && donors.length > 0) {
            renderDiseaseStatus(donors);
        }
    }
}

// ─── RENDER FUNCTIONS ───

function getBadgeClass(status) {
    const map = {
        'Eligible': 'eligible',
        'Eligible Donor': 'eligible',
        'Quarantine': 'quarantine',
        'Temporarily Deferred': 'temp-deferred',
        'Temp Deferred': 'temp-deferred',
        'Permanently Deferred': 'perm-deferred',
        'Perm Deferred': 'perm-deferred',
        'Under Review': 'pending',
        'Inactive': 'inactive',
        'Active': 'active',
        'HIV Positive - Refer to NSACP': 'perm-deferred',
        'Hepatitis Positive - Refer to Virology': 'perm-deferred',
        'Hepatitis Indeterminate - 1 Year Deferral': 'temp-deferred',
        'Syphilis Positive - Refer to STD Clinic': 'temp-deferred',
        'Malaria Positive - Refer to Anti-Malaria Campaign': 'temp-deferred',
        'Reinstated': 'eligible',
        'Counselled': 'eligible',
    };
    return map[status] || 'pending';
}

function getDiseaseStatusIcon(status) {
    if (status === 'Non-Reactive' || status === 'Negative' || status === 'Not Detected') {
        return '✅';
    }
    if (status === 'Reactive' || status === 'Positive' || status === 'Detected') {
        return '❌';
    }
    if (status === 'Indeterminate' || status === 'Pending') {
        return '⏳';
    }
    return '—';
}

function getDiseaseStatusClass(status) {
    if (status === 'Non-Reactive' || status === 'Negative' || status === 'Not Detected') {
        return 'negative';
    }
    if (status === 'Reactive' || status === 'Positive' || status === 'Detected') {
        return 'positive';
    }
    return '';
}

// ─── RENDER DONOR TABLE (Dashboard) ───
function renderDonorTable(data) {
    const tbody = $('donorTableBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No donors found</td></tr>`;
        return;
    }
    tbody.innerHTML = data.slice(0, 50).map(d => {
        const status = d.overall_status || d.status || 'Eligible Donor';
        const statusClass = getBadgeClass(status);
        
        const hiv = d.hiv_status || '—';
        const hbv = d.hbv_status || '—';
        const hcv = d.hcv_status || '—';
        const syphilis = d.syphilis_status || '—';
        const malaria = d.malaria_status || '—';
        
        return `
            <tr>
                <td><strong>${d.donor_uid}</strong></td>
                <td>${d.full_name}</td>
                <td>${d.blood_group || '—'}</td>
                <td><span class="badge-status ${statusClass}">${status}</span></td>
                <td class="disease-cell ${getDiseaseStatusClass(hiv)}">${getDiseaseStatusIcon(hiv)} ${hiv}</td>
                <td class="disease-cell ${getDiseaseStatusClass(hbv)}">${getDiseaseStatusIcon(hbv)} ${hbv}</td>
                <td class="disease-cell ${getDiseaseStatusClass(hcv)}">${getDiseaseStatusIcon(hcv)} ${hcv}</td>
                <td class="disease-cell ${getDiseaseStatusClass(syphilis)}">${getDiseaseStatusIcon(syphilis)} ${syphilis}</td>
                <td class="disease-cell ${getDiseaseStatusClass(malaria)}">${getDiseaseStatusIcon(malaria)} ${malaria}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="viewDonor('${d.donor_uid}')">View</button>
                </td>
            </tr>
        `;
    }).join('');
}

// ─── RENDER DONOR REGISTRY ───
function renderDonorRegistry(data) {
    const tbody = $('donorRegistryBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No donors registered</td></tr>`;
        return;
    }
    
    tbody.innerHTML = data.slice(0, 50).map(d => {
        // Determine eligibility
        let eligibility = '✅ Eligible';
        let eligibilityClass = 'eligible';
        const status = d.overall_status || d.status || 'Eligible Donor';
        
        if (status && (status.includes('Deferred') || status.includes('deferred'))) {
            eligibility = '🚫 Not Eligible';
            eligibilityClass = 'perm-deferred';
        } else if (status && status.includes('Positive')) {
            eligibility = '🚫 Not Eligible';
            eligibilityClass = 'perm-deferred';
        } else if (status && status === 'Under Review') {
            eligibility = '⏳ Pending';
            eligibilityClass = 'pending';
        }
        
        const statusClass = getBadgeClass(status);
        
        return `
            <tr>
                <td><strong>${d.donor_uid}</strong></td>
                <td>${d.full_name}</td>
                <td>${d.nic || '—'}</td>
                <td>${d.blood_group || '—'}</td>
                <td>${d.phone || '—'}</td>
                <td>${d.donor_type || 'Regular'}</td>
                <td>${d.last_donation ? new Date(d.last_donation).toLocaleDateString() : 'Never'}</td>
                <td><span class="badge-status ${eligibilityClass}">${eligibility}</span></td>
                <td><span class="badge-status ${statusClass}">${status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="viewDonor('${d.donor_uid}')">👁️ View</button>
                    <button class="btn btn-sm btn-success" onclick="proceedDonation('${d.donor_uid}')">🩸 Donate</button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderDiseaseStatus(data) {
    const tbody = $('diseaseStatusBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No disease data available</td></tr>`;
        return;
    }
    tbody.innerHTML = data.slice(0, 50).map(d => `
        <tr>
            <td><strong>${d.donor_uid}</strong> — ${d.full_name}</td>
            <td><span class="badge-status ${d.hiv_status === 'Reactive' || d.hiv_status === 'Positive' ? 'reactive' : 'non-reactive'}">${d.hiv_status || '—'}</span></td>
            <td><span class="badge-status ${d.hbv_status === 'Reactive' || d.hbv_status === 'Detected' ? 'reactive' : 'non-reactive'}">${d.hbv_status || '—'}</span></td>
            <td><span class="badge-status ${d.hcv_status === 'Reactive' || d.hcv_status === 'Detected' ? 'reactive' : 'non-reactive'}">${d.hcv_status || '—'}</span></td>
            <td><span class="badge-status ${d.syphilis_status === 'Reactive' ? 'reactive' : 'non-reactive'}">${d.syphilis_status || '—'}</span></td>
            <td><span class="badge-status ${d.malaria_status === 'Detected' ? 'reactive' : 'non-reactive'}">${d.malaria_status || '—'}</span></td>
            <td><span class="badge-status ${getBadgeClass(d.overall_status || d.unified_status)}">${d.overall_status || d.unified_status || 'Unknown'}</span></td>
            <td>
                <button class="btn btn-sm btn-outline" onclick="viewDonor('${d.donor_uid}')">View</button>
            </td>
        </tr>
    `).join('');
}

// ─── RENDER DEFERRAL TABLE ───
function renderDeferralTable(data) {
    const tbody = $('deferralTableBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No deferred donors found</td></tr>`;
        return;
    }
    
    tbody.innerHTML = data.map(d => {
        // Get disease name
        const diseaseName = d.disease_name || d.disease || '—';
        
        // Format retest date
        let retestDate = '—';
        if (d.retest_date) {
            const date = new Date(d.retest_date);
            retestDate = date.toLocaleDateString();
        }
        
        // Get donor info
        const donorUid = d.donor_uid || d.donorId || '—';
        const donorName = d.donor_name || d.full_name || '—';
        const deferralType = d.deferral_type || d.type || '—';
        const reason = d.deferral_reason || d.reason || '—';
        const status = d.is_reinstated ? '✅ Reinstated' : '🔒 Active';
        const statusClass = d.is_reinstated ? 'eligible' : 'perm-deferred';
        const deferralId = d.deferral_id || d.id || null;
        
        return `
            <tr>
                <td><strong>${donorUid}</strong> — ${donorName}</td>
                <td><span class="badge-status ${deferralType === 'Permanent' ? 'perm-deferred' : 'temp-deferred'}">${deferralType}</span></td>
                <td>${diseaseName}</td>
                <td>${reason}</td>
                <td>${retestDate}</td>
                <td>
                    <span class="badge-status ${statusClass}">${status}</span>
                    <button class="btn btn-sm btn-outline" onclick="viewDonor('${donorUid}')">👁️ View</button>
                    ${deferralType === 'Temporary' && !d.is_reinstated ? `<button class="btn btn-sm btn-success" onclick="reinstateDonor(${deferralId})">✅ Reinstate</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function renderAgencyTable(data) {
    const tbody = $('agencyTableBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No agencies connected</td></tr>`;
        return;
    }
    tbody.innerHTML = data.map(a => `
        <tr>
            <td><strong>${a.agency_name}</strong></td>
            <td>${a.agency_type}</td>
            <td>${a.city || '—'}</td>
            <td><span class="badge-status ${a.is_active ? 'active' : 'inactive'}">${a.is_active ? '🟢 Online' : '🔴 Offline'}</span></td>
            <td>${a.last_sync ? new Date(a.last_sync).toLocaleString() : 'Never'}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="syncAgency('${a.agency_code}')">📡 Sync</button>
            </td>
        </tr>
    `).join('');
}

// ─── SYNC INDIVIDUAL AGENCY ───
async function syncAgency(agencyCode) {
    showToast(`📡 Syncing ${agencyCode}...`, 'warning');
    try {
        await apiFetch(`/sync/agency/${agencyCode}`, { method: 'POST' });
        showToast(`✅ ${agencyCode} synced successfully`, 'success');
        await loadAgencies();
    } catch (err) {
        console.error(err);
    }
}

// ─── REINSTATE DONOR ───
async function reinstateDonor(deferralId) {
    if (!confirm('Are you sure you want to reinstate this donor?')) {
        return;
    }
    
    try {
        const result = await apiFetch(`/deferrals/${deferralId}/reinstate`, {
            method: 'PUT'
        });
        showToast('✅ Donor reinstated successfully!', 'success');
        // Reload deferrals
        await loadDeferrals();
        // Reload dashboard
        await loadDashboard();
    } catch (err) {
        console.error('Error reinstating donor:', err);
        showToast('Error reinstating donor', 'error');
    }
}

// ─── SEARCH DONOR ───
async function searchDonor() {
    const nic = document.getElementById('searchNIC').value.trim();
    const phone = document.getElementById('searchPhone').value.trim();
    const name = document.getElementById('searchName').value.trim();
    const donorId = document.getElementById('searchDonorId').value.trim();
    
    if (!nic && !phone && !name && !donorId) {
        showToast('Please enter at least one search criteria', 'error');
        return;
    }
    
    const params = new URLSearchParams();
    if (nic) params.append('nic', nic);
    if (phone) params.append('phone', phone);
    if (name) params.append('name', name);
    if (donorId) params.append('donor_uid', donorId);
    
    try {
        const response = await apiFetch(`/donors/search?${params.toString()}`);
        displaySearchResults(response);
    } catch (err) {
        console.error(err);
        showToast('Error searching donor', 'error');
    }
}

// ─── DISPLAY SEARCH RESULTS ───
function displaySearchResults(data) {
    const resultsDiv = document.getElementById('searchResults');
    const contentDiv = document.getElementById('searchResultContent');
    const statusDiv = document.getElementById('searchResultStatus');
    
    resultsDiv.style.display = 'block';
    currentSearchResults = data;
    
    if (!data.found) {
        statusDiv.innerHTML = '<span class="badge-status warning">⚠️ No Donor Found</span>';
        contentDiv.innerHTML = `
            <div class="alert-box warning">
                <p><strong>No donor found</strong> matching the search criteria.</p>
                <p>This appears to be a <strong>new donor</strong>.</p>
                <button class="btn btn-primary" onclick="closeSearchResults(); openModal('donorModal');">📝 Register New Donor</button>
            </div>
        `;
        return;
    }
    
    const donor = data.donor;
    const eligibility = data.eligibility;
    
    const statusBadge = eligibility.can_donate ? 
        '<span class="badge-status eligible">✅ Eligible to Donate</span>' :
        '<span class="badge-status perm-deferred">🚫 Not Eligible to Donate</span>';
    statusDiv.innerHTML = statusBadge;
    
    let html = `
        <div class="donor-history-card">
            <div class="donor-header">
                <div>
                    <h4>${donor.first_name} ${donor.last_name}</h4>
                    <p><strong>Donor ID:</strong> ${donor.donor_uid} | <strong>Blood Group:</strong> ${donor.blood_group || 'Not Recorded'}</p>
                    <p><strong>NIC:</strong> ${donor.nic || 'Not Recorded'} | <strong>Phone:</strong> ${donor.phone || 'Not Recorded'}</p>
                    <p><strong>Donor Type:</strong> ${donor.donor_type || 'Regular'} | <strong>Registered:</strong> ${new Date(donor.created_at).toLocaleDateString()}</p>
                </div>
                <div class="donor-status-badge">
                    ${statusBadge}
                </div>
            </div>
            
            <div class="eligibility-box ${eligibility.can_donate ? 'eligible' : 'not-eligible'}">
                <strong>${data.recommendation}</strong>
                ${eligibility.reason ? `<p style="margin-top:4px;font-size:14px;">${eligibility.reason}</p>` : ''}
            </div>
            
            <div class="history-summary">
                <div class="summary-item">
                    <span class="label">Total Tests</span>
                    <span class="value">${data.history_summary.total_tests || 0}</span>
                </div>
                <div class="summary-item">
                    <span class="label">Active Deferrals</span>
                    <span class="value">${data.history_summary.active_deferrals || 0}</span>
                </div>
                <div class="summary-item">
                    <span class="label">Reactive Tests</span>
                    <span class="value">${data.history_summary.reactive_tests || 0}</span>
                </div>
                <div class="summary-item">
                    <span class="label">Last Donation</span>
                    <span class="value">${data.history_summary.last_donation ? new Date(data.history_summary.last_donation).toLocaleDateString() : 'Never'}</span>
                </div>
            </div>
            
            <div class="action-buttons">
                <button class="btn btn-primary" onclick="viewDonorFull('${donor.donor_uid}')">👁️ View Full History</button>
                ${eligibility.can_donate ? `<button class="btn btn-success" onclick="proceedDonation('${donor.donor_uid}')">🩸 Proceed with Donation</button>` : ''}
                ${!eligibility.can_donate ? `<button class="btn btn-danger" onclick="showDeferralDetails('${donor.donor_uid}')">🚫 View Deferral Details</button>` : ''}
                <button class="btn btn-outline" onclick="closeSearchResults()">Close</button>
            </div>
        </div>
    `;
    
    contentDiv.innerHTML = html;
}

// ─── CLOSE SEARCH RESULTS ───
function closeSearchResults() {
    document.getElementById('searchResults').style.display = 'none';
    currentSearchResults = null;
}

// ─── CLEAR SEARCH ───
function clearSearch() {
    document.getElementById('searchNIC').value = '';
    document.getElementById('searchPhone').value = '';
    document.getElementById('searchName').value = '';
    document.getElementById('searchDonorId').value = '';
    closeSearchResults();
}

// ─── PROCEED WITH DONATION ───
function proceedDonation(donorId) {
    if (confirm(`🩸 Proceed with donation for donor ${donorId}?`)) {
        showToast(`✅ Donation process started for ${donorId}`, 'success');
        // In a real system, this would open a donation form
    }
}

// ─── SHOW DEFERRAL DETAILS ───
async function showDeferralDetails(donorId) {
    try {
        const data = await apiFetch(`/donors/${donorId}/history`);
        let msg = `🚫 DEFERRAL DETAILS\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `Donor: ${donorId}\n\n`;
        
        if (data.deferrals && data.deferrals.length > 0) {
            data.deferrals.forEach((d, i) => {
                msg += `Deferral #${i + 1}:\n`;
                msg += `  Type: ${d.deferral_type}\n`;
                msg += `  Reason: ${d.deferral_reason}\n`;
                msg += `  Date: ${new Date(d.deferral_date).toLocaleDateString()}\n`;
                if (d.retest_date) {
                    msg += `  Retest Date: ${new Date(d.retest_date).toLocaleDateString()}\n`;
                }
                msg += `  Status: ${d.is_reinstated ? '✅ Reinstated' : '❌ Active'}\n`;
                msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            });
        } else {
            msg += `No active deferrals found.\n`;
        }
        alert(msg);
    } catch (err) {
        console.error(err);
        showToast('Error fetching deferral details', 'error');
    }
}

// ─── VIEW DONOR FULL ───
async function viewDonorFull(uid) {
    try {
        const data = await apiFetch(`/donors/${uid}/history`);
        const donor = data.donor;
        const summary = data.summary;
        
        let msg = `🩸 DONOR PROFILE: ${donor.first_name} ${donor.last_name}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `Donor ID: ${donor.donor_uid}\n`;
        msg += `NIC: ${donor.nic || 'Not Recorded'}\n`;
        msg += `Blood Group: ${donor.blood_group || 'Not Recorded'}\n`;
        msg += `Donor Type: ${donor.donor_type || 'Regular'}\n`;
        msg += `Phone: ${donor.phone || 'Not Recorded'}\n`;
        msg += `Email: ${donor.email || 'Not Recorded'}\n`;
        msg += `Status: ${donor.overall_status || donor.unified_status || 'Eligible'}\n\n`;
        
        msg += `📊 SUMMARY:\n`;
        msg += `  Total Donations: ${summary.total_donations || 0}\n`;
        msg += `  Total Tests: ${summary.total_tests || 0}\n`;
        msg += `  Reactive Tests: ${summary.reactive_tests || 0}\n`;
        msg += `  Active Deferrals: ${summary.active_deferrals || 0}\n`;
        msg += `  Last Donation: ${summary.last_donation ? new Date(summary.last_donation).toLocaleDateString() : 'Never'}\n\n`;
        
        if (data.tests && data.tests.length > 0) {
            msg += `🧪 TEST HISTORY:\n`;
            msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            data.tests.slice(0, 5).forEach(t => {
                msg += `  ${t.disease_code || t.disease_name}: ${t.result} (${t.phase_name || 'Phase ' + t.phase})\n`;
                msg += `    Agency: ${t.agency_name || 'Unknown'}\n`;
                msg += `    Date: ${new Date(t.result_date).toLocaleDateString()}\n`;
            });
            if (data.tests.length > 5) {
                msg += `  ... and ${data.tests.length - 5} more tests\n`;
            }
            msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        }
        
        alert(msg);
    } catch (err) {
        console.error(err);
        showToast('Error fetching donor details', 'error');
    }
}

// ─── VIEW DONOR (Simple) ───
function viewDonor(uid) {
    const donor = donors.find(d => d.donor_uid === uid);
    if (!donor) {
        showToast('Donor not found', 'error');
        return;
    }
    
    let msg = `🩸 DONOR: ${donor.full_name} (${donor.donor_uid})\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Blood Group: ${donor.blood_group || '—'}\n`;
    msg += `Overall Status: ${donor.overall_status || donor.unified_status || 'Unknown'}\n\n`;
    msg += `📋 DISEASE STATUS:\n`;
    msg += `  HIV:      ${donor.hiv_status || '—'} (${donor.hiv_phase || ''} - ${donor.hiv_agency || ''})\n`;
    msg += `  HBV:      ${donor.hbv_status || '—'} (${donor.hbv_phase || ''} - ${donor.hbv_agency || ''})\n`;
    msg += `  HCV:      ${donor.hcv_status || '—'} (${donor.hcv_phase || ''} - ${donor.hcv_agency || ''})\n`;
    msg += `  Syphilis: ${donor.syphilis_status || '—'} (${donor.syphilis_phase || ''} - ${donor.syphilis_agency || ''})\n`;
    msg += `  Malaria:  ${donor.malaria_status || '—'} (${donor.malaria_phase || ''} - ${donor.malaria_agency || ''})\n`;
    msg += `\n📅 Registered: ${new Date(donor.registered_at).toLocaleDateString()}\n`;
    msg += `📅 Last Donation: ${donor.last_donation ? new Date(donor.last_donation).toLocaleDateString() : 'Never'}`;
    
    alert(msg);
}

// ─── SEARCH DONORS (Simple) ───
function searchDonors() {
    const query = $('donorSearch').value.toLowerCase().trim();
    if (!query) {
        renderDonorRegistry(donors);
        return;
    }
    const filtered = donors.filter(d => 
        d.donor_uid.toLowerCase().includes(query) ||
        d.full_name.toLowerCase().includes(query) ||
        (d.phone && d.phone.includes(query)) ||
        (d.nic && d.nic.toLowerCase().includes(query))
    );
    renderDonorRegistry(filtered);
}

// ─── REGISTER DONOR ───
async function registerDonor(event) {
    event.preventDefault();
    
    // Get form values
    const firstName = document.getElementById('dFirstName').value.trim();
    const lastName = document.getElementById('dLastName').value.trim();
    const dateOfBirth = document.getElementById('dDOB').value;
    const gender = document.getElementById('dGender').value;
    const bloodGroup = document.getElementById('dBloodGroup').value;
    const phone = document.getElementById('dPhone').value.trim();
    const email = document.getElementById('dEmail').value.trim();
    const address = document.getElementById('dAddress').value.trim();
    const city = document.getElementById('dCity')?.value?.trim() || '';
    const state = document.getElementById('dState')?.value?.trim() || '';
    const pincode = document.getElementById('dPincode')?.value?.trim() || '';
    const nic = document.getElementById('dNIC')?.value?.trim() || '';
    const passport = document.getElementById('dPassport')?.value?.trim() || '';
    const donorType = document.getElementById('dDonorType')?.value || 'Regular';

    // Validate required fields
    if (!firstName || !lastName || !dateOfBirth || !phone) {
        showToast('Please fill in all required fields (First Name, Last Name, DOB, Phone)', 'error');
        return;
    }

    const data = {
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dateOfBirth,
        gender: gender,
        blood_group: bloodGroup,
        phone: phone,
        email: email || '',
        address: address || '',
        city: city || '',
        state: state || '',
        pincode: pincode || '',
        nic: nic || '',
        passport: passport || '',
        donor_type: donorType || 'Regular'
    };

    try {
        const result = await apiFetch('/donors', {
            method: 'POST',
            body: JSON.stringify(data),
        });
        
        showToast(`✅ Donor ${result.donor_uid} registered successfully!`, 'success');
        closeModal('donorModal');
        document.getElementById('donorForm').reset();
        await loadDashboard();
    } catch (err) {
        console.error('Registration error:', err);
        showToast('Error registering donor. Please check console for details.', 'error');
    }
}

// ─── ENTER TEST RESULT ───
async function enterTestResult(event) {
    event.preventDefault();
    const data = {
        donor_uid: $('tDonorId').value.trim(),
        disease: $('tDisease').value,
        phase: $('tPhase').value,
        method: $('tMethod').value,
        agency: $('tAgency').value,
        result: $('tResult').value,
        next_action: $('tNextAction').value,
        notes: $('tNotes').value.trim(),
    };

    try {
        const result = await apiFetch('/tests', {
            method: 'POST',
            body: JSON.stringify(data),
        });
        showToast(`✅ ${data.disease} test result recorded for ${data.donor_uid}`, 'success');
        closeModal('testModal');
        $('testForm').reset();
        await loadDashboard();
    } catch (err) {
        console.error(err);
    }
}

// ─── MODALS ───
function openModal(id) {
    $(id).classList.add('open');
}

function closeModal(id) {
    $(id).classList.remove('open');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('open');
        }
    });
});

// ─── TAB SWITCHING ───
document.querySelectorAll('.sidebar nav a[data-tab]').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();

        document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
        this.classList.add('active');

        const tabId = this.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        const target = $('tab-' + tabId);
        if (target) target.classList.add('active');

        const titles = {
            dashboard: '📊 Multi-Disease Dashboard',
            donors: '👤 Donor Registry',
            'disease-status': '🩺 Disease Status',
            tests: '🧪 Test Results',
            deferrals: '🚫 Deferral Management',
            agencies: '🏛️ Connected Agencies',
            counselling: '🧠 Counselling Management'
        };
        $('pageTitle').textContent = titles[tabId] || 'Dashboard';

        // Load data for specific tabs
        if (tabId === 'deferrals') {
            loadDeferrals();
        } else if (tabId === 'agencies') {
            loadAgencies();
        } else if (tabId === 'disease-status') {
            loadDiseaseStatus();
        } else if (tabId === 'counselling') {
            loadCounselling();
        }
    });
});

// ─── COUNSELLING FUNCTIONS ───

// Load counselling data
async function loadCounselling() {
    try {
        // Load all sessions
        const sessions = await apiFetch('/counselling');
        renderCounsellingTable(sessions);
        
        // Load pending tasks
        const pending = await apiFetch('/counselling/pending');
        renderPendingCounselling(pending);
        
        // Load analytics
        const analytics = await apiFetch('/counselling/analytics');
        updateCounsellingStats(analytics);
        
    } catch (err) {
        console.error('Failed to load counselling:', err);
    }
}

// Render counselling table
function renderCounsellingTable(data) {
    const tbody = $('counsellingTableBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No counselling sessions found</td></tr>`;
        return;
    }
    
    tbody.innerHTML = data.slice(0, 50).map(d => `
        <tr>
            <td><strong>${d.donor_uid}</strong> — ${d.donor_name}</td>
            <td><span class="badge-status ${d.session_type === 'Positive Result' ? 'perm-deferred' : 'temp-deferred'}">${d.session_type}</span></td>
            <td>${d.counsellor_name || '—'}</td>
            <td>${new Date(d.session_date).toLocaleDateString()}</td>
            <td>${d.outcome_type || 'Pending'}</td>
            <td>
                <button class="btn btn-sm btn-outline" onclick="viewCounselling(${d.session_id})">👁️ View</button>
                ${!d.outcome_type ? `<button class="btn btn-sm btn-primary" onclick="openCounsellingOutcome(${d.session_id})">📝 Record Outcome</button>` : ''}
            </td>
        </tr>
    `).join('');
}

// Render pending counselling
function renderPendingCounselling(data) {
    const tbody = $('counsellingPendingBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No pending tasks</td></tr>`;
        return;
    }
    
    tbody.innerHTML = data.map(d => `
        <tr>
            <td><strong>${d.donor_uid}</strong> — ${d.donor_name}</td>
            <td>${d.session_type}</td>
            <td>${new Date(d.session_date).toLocaleDateString()}</td>
            <td><span class="badge-status pending">Pending</span></td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="openCounsellingOutcome(${d.session_id})">📝 Record</button>
            </td>
        </tr>
    `).join('');
}

// Update counselling stats
function updateCounsellingStats(data) {
    if (!data || data.length === 0) return;
    
    const total = data.reduce((sum, d) => sum + parseInt(d.total_sessions || 0), 0);
    const completed = data.reduce((sum, d) => sum + parseInt(d.completed || 0), 0);
    const pending = data.reduce((sum, d) => sum + (parseInt(d.total_sessions || 0) - parseInt(d.completed || 0)), 0);
    const referred = data.reduce((sum, d) => sum + parseInt(d.referred || 0), 0);
    
    $('counsellingTotal').textContent = total;
    $('counsellingCompleted').textContent = completed;
    $('counsellingPending').textContent = pending;
    $('counsellingReferred').textContent = referred;
}

// Open counselling outcome modal
function openCounsellingOutcome(sessionId) {
    $('coSessionId').value = sessionId;
    openModal('counsellingOutcomeModal');
}

// ─── REFRESH ───
function refreshData() {
    showToast('🔄 Refreshing data...', 'warning');
    loadDashboard();
}

// ─── KEYBOARD SHORTCUTS ───
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        closeSearchResults();
    }
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
        e.preventDefault();
        refreshData();
    }
    if (e.key === 'Enter') {
        // Check if search inputs have focus
        const active = document.activeElement;
        if (active && ['searchNIC', 'searchPhone', 'searchName', 'searchDonorId'].includes(active.id)) {
            searchDonor();
        }
    }
});

// ─── INIT ───
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in
    const token = getToken();
    
    if (!token) {
        // No token, redirect to login
        window.location.href = 'login.html';
        return;
    }
    
    // Verify token is valid
    fetch(`${API_BASE}/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) {
            localStorage.removeItem('bbms_token');
            localStorage.removeItem('bbms_user');
            window.location.href = 'login.html';
        } else {
            // Update user info if changed
            if (data.user) {
                localStorage.setItem('bbms_user', JSON.stringify(data.user));
                updateUserDisplay();
            }
            // Load dashboard
            loadDashboard();
            console.log('🩸 Multi-Disease Blood Bank Management System loaded.');
            console.log('👤 Logged in as:', data.user?.full_name || data.user?.username);
            console.log('📋 Connected to API:', API_BASE);
            console.log('🦠 Supported Diseases: HIV, HBV, HCV, Syphilis, Malaria');
            console.log('🔍 Search by: NIC, Phone, Name, Donor ID');
            console.log('🧠 Counselling Module: Enabled');
        }
    })
    .catch(() => {
        localStorage.removeItem('bbms_token');
        localStorage.removeItem('bbms_user');
        window.location.href = 'login.html';
    });
});