-- Electorate of the counted sections (EA20 e.est): with turnout, gives abstentions counted so far.
ALTER TABLE zone_result ADD COLUMN counted_electorate INTEGER CHECK(counted_electorate>=0);
