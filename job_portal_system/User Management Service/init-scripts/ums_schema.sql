--User Management Service schema
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL,
    email         VARCHAR(150)  NOT NULL UNIQUE,
    password VARCHAR(255)  NOT NULL,
    role          VARCHAR(20)   NOT NULL CHECK (role IN ('seeker', 'employer')),
);

CREATE TABLE IF NOT EXISTS seeker_profiles (
    id         SERIAL PRIMARY KEY,
    user_id    INT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bio        TEXT,
    resume_url VARCHAR(500),
    skills     TEXT[],
    UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS employer_profiles (
    id           SERIAL PRIMARY KEY,
    user_id      INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(150) NOT NULL,
    website      VARCHAR(300),
    description  TEXT,
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

