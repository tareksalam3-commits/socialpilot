-- Prevent invalid negative AI costs from corrupting usage dashboards.
-- Existing negative values are normalized to zero because the source rate was invalid
-- or represented an unknown/free price rather than a payable USD amount.
UPDATE public.ai_models
SET input_cost_per_1k = GREATEST(COALESCE(input_cost_per_1k, 0), 0),
    output_cost_per_1k = GREATEST(COALESCE(output_cost_per_1k, 0), 0)
WHERE input_cost_per_1k < 0 OR output_cost_per_1k < 0;

UPDATE public.ai_runs
SET cost_usd = GREATEST(COALESCE(cost_usd, 0), 0)
WHERE cost_usd < 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_models_nonnegative_input_cost'
      AND conrelid = 'public.ai_models'::regclass
  ) THEN
    ALTER TABLE public.ai_models
      ADD CONSTRAINT ai_models_nonnegative_input_cost
      CHECK (input_cost_per_1k IS NULL OR input_cost_per_1k >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_models_nonnegative_output_cost'
      AND conrelid = 'public.ai_models'::regclass
  ) THEN
    ALTER TABLE public.ai_models
      ADD CONSTRAINT ai_models_nonnegative_output_cost
      CHECK (output_cost_per_1k IS NULL OR output_cost_per_1k >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_runs_nonnegative_cost'
      AND conrelid = 'public.ai_runs'::regclass
  ) THEN
    ALTER TABLE public.ai_runs
      ADD CONSTRAINT ai_runs_nonnegative_cost
      CHECK (cost_usd >= 0);
  END IF;
END $$;
