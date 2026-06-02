# Vercel + Supabase pending outreach setup

This scanner still keeps the heavy CA SCO scanner/search database local. The
public Vercel deployment is used for recipient confirmation links:

1. Local scanner sends the recovery offer.
2. Pending outreach is written to Supabase.
3. Email link points to the public Vercel scanner URL.
4. Public confirmation page reads the pending outreach row from Supabase.
5. After confirmation, the public scanner calls the CMS conversion endpoint.

## Supabase

Run `docs/supabase-pending-outreach.sql` in the Supabase SQL editor for the
project you want to use.

Use the Supabase service role key only in server-side environment variables.
Do not expose it with a `NEXT_PUBLIC_` prefix.

## Vercel environment variables

Set these in the scanner Vercel project:

```txt
DATABASE_URL=file:./data/scanner.db
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
NEXT_PUBLIC_SCANNER_BASE_URL=https://YOUR-SCANNER.vercel.app
CCC_SCANNER_BASE_URL=https://YOUR-SCANNER.vercel.app
CLAIMS_INTAKE_BASE_URL=https://YOUR-CMS.vercel.app
LEAD_IMPORT_API_TOKEN=change-me-to-a-real-secret
```

`DATABASE_URL` is still needed for Prisma generation/build, but the public
confirmation flow uses Supabase when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are present.

## Local scanner environment variables

Set the same Supabase variables locally before sending real recovery offers:

```txt
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
NEXT_PUBLIC_SCANNER_BASE_URL=https://YOUR-SCANNER.vercel.app
CCC_SCANNER_BASE_URL=https://YOUR-SCANNER.vercel.app
CLAIMS_INTAKE_BASE_URL=https://YOUR-CMS.vercel.app
```

This makes locally sent recovery emails contain a public confirmation link and
stores the pending outreach row where Vercel can read it.

## Test before real outreach

Send one recovery offer to yourself, open the link from a phone or another
network, confirm one property, reject one property, and verify the CMS claim was
created once.
