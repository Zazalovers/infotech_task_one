CREATE TYPE email_job_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE email_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_address          text NOT NULL,
  subject             text NOT NULL,
  html_body           text,
  text_body           text,
  status              email_job_status NOT NULL DEFAULT 'pending',
  attempts            integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 4,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  locked_until        timestamptz,
  last_error          text,
  provider_message_id text,
  idempotency_key     text UNIQUE,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_jobs_body_present CHECK (html_body IS NOT NULL OR text_body IS NOT NULL),
  CONSTRAINT email_jobs_attempts_non_negative CHECK (attempts >= 0),
  CONSTRAINT email_jobs_max_attempts_min CHECK (max_attempts >= 4)
);

-- Hot path for the worker's claim query.
CREATE INDEX idx_email_jobs_claimable ON email_jobs (next_attempt_at) WHERE status = 'pending';

-- GET /emails?status=... ordered by newest first.
CREATE INDEX idx_email_jobs_status_created ON email_jobs (status, created_at DESC);
