
CREATE TABLE IF NOT EXISTS jobs (
    id          SERIAL PRIMARY KEY,
    employer_id INT           NOT NULL,
    title       VARCHAR(200)  NOT NULL,
    description TEXT          NOT NULL,
    company     VARCHAR(150)  NOT NULL,
    location    VARCHAR(150)  NOT NULL,
    job_type    VARCHAR(50)   NOT NULL CHECK (job_type IN (
                    'full-time','part-time','contract','internship','remote'
                )),
    salary_min  NUMERIC(10,2),
    salary_max  NUMERIC(10,2),
    skills      TEXT[],
    status      VARCHAR(20)   NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','closed','draft'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_employer_id ON jobs(employer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_location    ON jobs(location);
CREATE INDEX IF NOT EXISTS idx_jobs_skills      ON jobs USING GIN(skills);
