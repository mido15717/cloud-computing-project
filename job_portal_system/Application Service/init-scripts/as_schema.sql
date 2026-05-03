# Application Service schema
CREATE TABLE IF NOT EXISTS applications (
    id           SERIAL PRIMARY KEY,
    job_id       INT         NOT NULL,
    seeker_id    INT         NOT NULL,
    cover_letter TEXT,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','reviewed','accepted','rejected')),

    UNIQUE (job_id, seeker_id)
);

CREATE TABLE IF NOT EXISTS application_status_history (
    id             SERIAL PRIMARY KEY,
    application_id INT         NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    old_status     VARCHAR(20),
    new_status     VARCHAR(20) NOT NULL,
    changed_by     INT
);

CREATE INDEX IF NOT EXISTS idx_applications_job_id    ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_seeker_id ON applications(seeker_id);
CREATE INDEX IF NOT EXISTS idx_applications_status    ON applications(status);

