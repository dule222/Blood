-- ============================================================
-- MULTI-DISEASE BLOOD BANK DATABASE SCHEMA
-- ============================================================

-- 1. DISEASES
CREATE TABLE IF NOT EXISTS diseases (
    disease_id      SERIAL PRIMARY KEY,
    disease_name    VARCHAR(50) NOT NULL,
    disease_code    VARCHAR(10) UNIQUE NOT NULL,
    description     TEXT,
    is_active       BOOLEAN DEFAULT TRUE
);

INSERT INTO diseases (disease_name, disease_code, description) VALUES
('HIV', 'HIV', 'Human Immunodeficiency Virus'),
('Hepatitis B', 'HBV', 'Hepatitis B Virus'),
('Hepatitis C', 'HCV', 'Hepatitis C Virus'),
('Syphilis', 'SYPH', 'Treponema pallidum infection'),
('Malaria', 'MAL', 'Plasmodium parasite infection')
ON CONFLICT (disease_code) DO NOTHING;

-- 2. AGENCIES
CREATE TABLE IF NOT EXISTS agencies (
    agency_id       SERIAL PRIMARY KEY,
    agency_name     VARCHAR(100) NOT NULL,
    agency_code     VARCHAR(20) UNIQUE NOT NULL,
    agency_type     VARCHAR(30) CHECK (agency_type IN ('Hospital', 'NBC', 'NSACP', 'Virology', 'Clinic', 'Campaign')),
    address         TEXT,
    city            VARCHAR(50),
    state           VARCHAR(50),
    phone           VARCHAR(20),
    email           VARCHAR(100),
    api_endpoint    VARCHAR(255),
    api_key         VARCHAR(100),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO agencies (agency_name, agency_code, agency_type, city) VALUES
('City General Hospital', 'CGH-01', 'Hospital', 'Colombo'),
('National Blood Center', 'NBC-01', 'NBC', 'Colombo'),
('NSACP', 'NSACP-01', 'NSACP', 'Colombo'),
('Kandy Virology Lab', 'KVL-01', 'Virology', 'Kandy'),
('Colombo MRI Virology', 'CMRI-01', 'Virology', 'Colombo'),
('Anti-Malaria Campaign', 'AMC-01', 'Campaign', 'Colombo'),
('STD Clinic', 'STD-01', 'Clinic', 'Colombo')
ON CONFLICT (agency_code) DO NOTHING;

-- 3. DONORS
CREATE TABLE IF NOT EXISTS donors (
    donor_id            SERIAL PRIMARY KEY,
    donor_uid           VARCHAR(20) UNIQUE NOT NULL,
    first_name          VARCHAR(50) NOT NULL,
    last_name           VARCHAR(50) NOT NULL,
    date_of_birth       DATE NOT NULL,
    gender              VARCHAR(10) CHECK (gender IN ('M', 'F', 'Other')),
    blood_group         VARCHAR(3) CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    phone               VARCHAR(20),
    email               VARCHAR(100),
    address             TEXT,
    city                VARCHAR(50),
    state               VARCHAR(50),
    pincode             VARCHAR(10),
    registration_status VARCHAR(20) DEFAULT 'Active' CHECK (registration_status IN ('Active', 'Inactive', 'Deceased')),
    status              VARCHAR(100),  -- Overall status
    status_details      JSONB,         -- Detailed status breakdown
    last_donation       DATE,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. DONATIONS
CREATE TABLE IF NOT EXISTS donations (
    donation_id      SERIAL PRIMARY KEY,
    donor_id         INTEGER REFERENCES donors(donor_id),
    donation_date    DATE NOT NULL,
    donation_type    VARCHAR(20) CHECK (donation_type IN ('Whole Blood', 'Apheresis', 'Platelet', 'Plasma')),
    volume_ml        INTEGER,
    center_id        INTEGER REFERENCES agencies(agency_id),
    batch_number     VARCHAR(50),
    donation_status  VARCHAR(20) DEFAULT 'Collected' CHECK (donation_status IN ('Collected', 'Quarantine', 'Released', 'Discarded')),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. DONOR DISEASE TESTS
CREATE TABLE IF NOT EXISTS donor_disease_tests (
    test_id          SERIAL PRIMARY KEY,
    donor_id         INTEGER REFERENCES donors(donor_id) ON DELETE CASCADE,
    donation_id      INTEGER REFERENCES donations(donation_id),
    disease_id       INTEGER REFERENCES diseases(disease_id),
    phase            INTEGER CHECK (phase IN (1, 2, 3, 4)),
    phase_name       VARCHAR(50),
    test_method      VARCHAR(50),
    agency_id        INTEGER REFERENCES agencies(agency_id),
    result           VARCHAR(20) CHECK (result IN ('Reactive', 'Non-Reactive', 'Detected', 'Not Detected', 'Positive', 'Negative', 'Indeterminate', 'Pending', 'N/A')),
    result_date      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    performed_by     VARCHAR(100),
    notes            TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. DEFERRALS
CREATE TABLE IF NOT EXISTS deferrals (
    deferral_id      SERIAL PRIMARY KEY,
    donor_id         INTEGER REFERENCES donors(donor_id) ON DELETE CASCADE,
    deferral_type    VARCHAR(20) CHECK (deferral_type IN ('Temporary', 'Permanent')),
    deferral_reason  TEXT NOT NULL,
    deferral_date    DATE NOT NULL,
    retest_date      DATE,
    is_reinstated    BOOLEAN DEFAULT FALSE,
    reinstated_date  DATE,
    referred_to      VARCHAR(100),
    referral_date    DATE,
    disease_id       INTEGER REFERENCES diseases(disease_id),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. ALGORITHM LOG
CREATE TABLE IF NOT EXISTS algorithm_log (
    log_id           SERIAL PRIMARY KEY,
    donor_id         INTEGER REFERENCES donors(donor_id) ON DELETE CASCADE,
    donation_id      INTEGER REFERENCES donations(donation_id),
    step_name        VARCHAR(50),
    action_taken     TEXT,
    result           VARCHAR(20),
    performed_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    performed_by     VARCHAR(100)
);

-- 8. INDEXES
CREATE INDEX IF NOT EXISTS idx_donors_uid ON donors(donor_uid);
CREATE INDEX IF NOT EXISTS idx_donors_phone ON donors(phone);
CREATE INDEX IF NOT EXISTS idx_tests_donor ON donor_disease_tests(donor_id);
CREATE INDEX IF NOT EXISTS idx_tests_disease ON donor_disease_tests(disease_id);
CREATE INDEX IF NOT EXISTS idx_tests_date ON donor_disease_tests(result_date);
CREATE INDEX IF NOT EXISTS idx_deferrals_donor ON deferrals(donor_id);
CREATE INDEX IF NOT EXISTS idx_deferrals_date ON deferrals(deferral_date);
CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(donation_status);