CREATE TABLE IF NOT EXISTS users (
    id  serial primary key,
    name    varchar(100) NOT NULL,
    email   varchar(150) NOT NULL UNIQUE,
    role    varchar(20) NOT NULL CHECK (role IN ('seeker','employer')),
)

CREATE TABLE IF NOT EXISTS seeker_profile (
    id  serial primary key,
    user_id INT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    bio TEXT,
    resume_url varchar(500),
    skills TEXT[],
    UNIQUE(user_id)
)

CREATE TABLE IF NOT EXISTS employer_profile (
    id  serial primary key,
    user_id INT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    company_name varchar(150),
    website varchar(300),
    description TEXT,
    UNIQUE(user_id)
)

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);