CREATE OR REPLACE FUNCTION bap_document_sequence_forward()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_value < OLD.last_value THEN
    RAISE EXCEPTION 'Sequence %-%-% cannot go back from % to %: numbers are never reused.',
      OLD.prefix, OLD.site_code, OLD.year, OLD.last_value, NEW.last_value
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
