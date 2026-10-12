-- PriceBook keyed by unit too: one model can have several units (input/output tokens, actor start/item).
-- Before this, the seed silently skipped every unit after the first for the same model and date.
DROP INDEX "PriceBook_provider_model_effectiveFrom_key";

CREATE UNIQUE INDEX "PriceBook_provider_model_unit_effectiveFrom_key" ON "PriceBook"("provider", "model", "unit", "effectiveFrom");
