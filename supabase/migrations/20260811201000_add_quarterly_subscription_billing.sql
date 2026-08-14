-- Add quarterly pricing and billing-cycle support for administrator-managed subscriptions.
-- Existing plans receive a neutral quarterly default equal to three monthly periods;
-- administrators can adjust this value from the Subscription Plans page.
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS price_quarterly numeric(10,2) NOT NULL DEFAULT 0;

UPDATE public.subscription_plans
SET price_quarterly = price_monthly * 3
WHERE price_quarterly = 0
  AND price_monthly > 0;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly'));
