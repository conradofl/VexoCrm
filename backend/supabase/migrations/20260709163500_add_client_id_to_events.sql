-- Add client_id column to events table to support multi-tenancy
ALTER TABLE IF EXISTS public.events 
ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Create an index for faster filtering by client_id
CREATE INDEX IF NOT EXISTS idx_events_client_id ON public.events (client_id);
