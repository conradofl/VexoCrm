// Helper centralizado para canonicalização de telefones em queries PostgreSQL.
// Garante casamento exato no padrão brasileiro com ou sem 9º dígito e DDI 55.

export const SQL_CANONICAL_PHONE = (col) => `
  CASE
    WHEN ${col} LIKE '%@%' THEN ${col}
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 12 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^55[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(${col}, '\\D', '', 'g'), 3, 2) || '9' || substr(regexp_replace(${col}, '\\D', '', 'g'), 5)
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 10 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(${col}, '\\D', '', 'g'), 1, 2) || '9' || substr(regexp_replace(${col}, '\\D', '', 'g'), 3)
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 10 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}[2-5]'
      THEN '55' || regexp_replace(${col}, '\\D', '', 'g')
    WHEN length(regexp_replace(${col}, '\\D', '', 'g')) = 11 AND regexp_replace(${col}, '\\D', '', 'g') ~ '^[1-9]{2}9'
      THEN '55' || regexp_replace(${col}, '\\D', '', 'g')
    ELSE regexp_replace(${col}, '\\D', '', 'g')
  END
`;
