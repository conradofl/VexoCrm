CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date timestamp with time zone,
  location text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Trigger for updated_at (assuming set_updated_at function exists, otherwise just omit or use standard)
-- But standard is good enough if we don't have it.
