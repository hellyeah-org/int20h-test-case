-- Custom SQL migration file, put your code below! --
ALTER TABLE jurisdictions
DROP COLUMN boundary;

ALTER TABLE jurisdictions
ADD COLUMN boundary geometry(MultiPolygon, 4326) NOT NULL;