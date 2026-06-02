# State Unclaimed Property Data Access Report

Date: 2026-05-23

Purpose: identify which state-level unclaimed-property systems are most useful for CCC Scanner Engine ingestion, lead discovery, and outreach. This first pass focuses on the highest state-level program in each state, not county or municipal sources.

## Executive Findings

- California is the strongest ingestion target because the State Controller publishes the public unclaimed-property database as downloadable CSV files and says the files are updated every Thursday.
- Most states provide a free search portal, but not an obvious public bulk owner/property export. Those states are still useful for manual verification, direct one-off search, or a permission-based/API/public-records strategy, but they are not immediately as scalable as California.
- NAUPA is the best official directory spine. NAUPA says each state maintains its own database and links directly to each official state program. NAUPA also says most states participate in MissingMoney.com, which can search participating states and then point users back into official claim workflows.
- MissingMoney is useful as a background search/checking layer, but it is not, by itself, a clean bulk database feed for CCC. It should be treated as a multi-state public search interface, not a guaranteed source of downloadable records.
- Automation friction varies. Some states have explicit anti-bot language or interfaces that block automated reads. Pennsylvania, for example, states it will not respond to claim information or claim submissions made by bots or AI. Michigan and some other search portals may also present runtime/bot friction. Use official downloads, documented APIs, permission, or public-record requests before scraping.

## Priority Tiers For CCC

### Tier 1: Direct Bulk Ingestion

| State | Why |
|---|---|
| California | Official public CSV download, weekly updates, already loaded into CCC. |

### Tier 2: Investigate For Data Agreements / Public Records / Hidden Export

These states have large commercial upside and robust official search portals, but this pass did not confirm a public all-record CSV equivalent to California:

Texas, New York, Florida, Illinois, Pennsylvania, Ohio, New Jersey, Massachusetts, Michigan, North Carolina, Georgia, Virginia, Washington.

### Tier 3: Use Search Portal / MissingMoney For Verification

Most remaining states. They are useful for manual verification, but less immediately useful for automated top-of-funnel lead generation unless a lawful data source is found.

## Official Sources Used

- NAUPA state directory and MissingMoney explanation: https://unclaimed.org/search/
- California bulk CSV download page: https://www.sco.ca.gov/upd_download_property_records.html
- Arizona Department of Revenue unclaimed property page: https://azdor.gov/unclaimed-property
- Pennsylvania Treasury unclaimed property page: https://www.patreasury.gov/unclaimed-property/
- Pennsylvania OpenBookPA county-level unclaimed-property aggregate data: https://www.patreasury.gov/openbookpa/county-level-data.php
- New York Comptroller unclaimed funds page: https://www.osc.ny.gov/unclaimed-funds
- Texas official claim portal: https://claimittexas.org/
- Michigan official portal: https://unclaimedproperty.michigan.gov/

## MissingMoney Assessment

NAUPA describes MissingMoney.com as a free NAUPA-sponsored multi-state search site for participating state databases. For CCC, that means:

- Good for cross-state owner-name verification.
- Good for seeing whether a state participates and routing into official claim workflows.
- Not currently a replacement for a state-provided CSV/bulk file.
- Not ideal for scraping unless there is an approved API, agreement, or clearly permitted access pattern.
- Best use inside CCC: a "verify externally" link or manual research helper, not a primary ingestion engine.

## 50-State Matrix

Legend:

- Platform: `Native` means the state appears to run its own branded/state-hosted search flow. `MissingMoney-linked` means the state page points users to MissingMoney for search or uses a MissingMoney/Avenu-style state portal. `FindYourUnclaimedProperty` means the NAUPA official link is on a `findyourunclaimedproperty.com` subdomain.
- Bulk data: `Confirmed` means an official owner/property CSV/XLS download was found. `Not found` means no public all-record owner/property download was found in this first pass. `Partial/aggregate` means the source has some data export or aggregate data, but not a California-like full owner/property file.

| State | Official program / agency | Official URL | Platform notes | Public bulk owner/property data | CCC ingestion note |
|---|---|---|---|---|---|
| Alabama | State Treasurer / Unclaimed Property | https://alabama.findyourunclaimedproperty.com | FindYourUnclaimedProperty portal | Not found | Search/verify first; investigate data agreement. |
| Alaska | Department of Revenue, Treasury Division | https://treasury.dor.alaska.gov | Native state site | Not found | Search/verify first. |
| Arizona | Department of Revenue | https://azdor.gov/unclaimed-property | State page authorizes MissingMoney for owner search | Not found | MissingMoney-linked; useful for verification, not bulk ingestion yet. |
| Arkansas | Auditor of State | https://auditor.ar.gov | Native state site | Not found | Search/verify first. |
| California | State Controller's Office | https://www.sco.ca.gov/upd_download_property_records.html | Native search plus official CSV download | Confirmed CSV, updated Thursdays | Already Tier 1. Keep weekly staged import workflow. |
| Colorado | State Treasurer | https://colorado.findyourunclaimedproperty.com | FindYourUnclaimedProperty portal | Not found | Search/verify first; likely not bulk-friendly without permission. |
| Connecticut | Office of the Treasurer / CT Big List | https://ctbiglist.gov | Native branded portal | Not found | Search/verify first. |
| Delaware | Department of Finance / Office of Unclaimed Property | https://unclaimedproperty.delaware.gov | Native state portal | Not found | High corporate volume, worth public-record/data-access investigation. |
| Florida | Department of Financial Services | https://fltreasurehunt.gov | Native branded portal | Not found | High priority for data-access investigation. |
| Georgia | Department of Revenue | https://dor.georgia.gov | Native state site | Not found | Search/verify first; investigate export/API. |
| Hawaii | Department of Budget and Finance | https://budget.hawaii.gov | Native state site | Not found | Search/verify first. |
| Idaho | State Treasurer | https://yourmoney.idaho.gov | Native branded portal | Not found | Search/verify first. |
| Illinois | State Treasurer / I-Cash | https://icash.illinoistreasurer.gov | Native branded portal | Not found | High priority for data-access investigation. |
| Indiana | Attorney General / Unclaimed Property Division | https://indianaunclaimed.gov | Native branded portal | Not found | Search/verify first. |
| Iowa | State Treasurer | https://www.iowatreasurer.gov | Native state site | Not found | Search/verify first. |
| Kansas | State Treasurer / KansasCash | https://kansascash.ks.gov | Native branded portal | Not found | Search/verify first. |
| Kentucky | State Treasury | https://treasury.ky.gov | Native state site | Not found | Search/verify first. |
| Louisiana | State Treasurer / LaCashClaim | https://LaCashClaim.org | Native branded portal | Not found | Search/verify first. |
| Maine | State Treasurer | https://maineunclaimedproperty.gov | Native branded portal | Not found | Search/verify first. |
| Maryland | Comptroller of Maryland | https://www.marylandtaxes.gov | Native state site | Not found | Search/verify first. |
| Massachusetts | State Treasurer / FindMassMoney | https://www.findmassmoney.com | Native branded portal | Not found | Worth investigating for export/API because of volume. |
| Michigan | Department of Treasury | https://unclaimedproperty.michigan.gov | Native portal with likely bot/runtime friction | Not found | Use manual/permission path first; user observed anti-robot behavior. |
| Minnesota | Department of Commerce | https://mn.gov | Native state site | Not found | Search/verify first. |
| Mississippi | State Treasurer | https://treasury.ms.gov | Native state site | Not found | Search/verify first. |
| Missouri | State Treasurer | https://treasurer.mo.gov | Native state site | Not found | Search/verify first. |
| Montana | Department of Revenue | https://mtrevenue.gov | Native state site | Not found | Search/verify first. |
| Nebraska | State Treasurer | https://treasurer.nebraska.gov | Native state site | Not found | Search/verify first. |
| Nevada | State Treasurer | https://www.nevadatreasurer.gov | Native state site | Not found | Search/verify first. |
| New Hampshire | State Treasury | https://newhampshire.findyourunclaimedproperty.com | FindYourUnclaimedProperty portal | Not found | Search/verify first. |
| New Jersey | Department of the Treasury / UPA | https://www.unclaimedproperty.nj.gov | Native state portal | Not found | High priority for data-access investigation. |
| New Mexico | Taxation and Revenue Department | https://www.tax.newmexico.gov | Native state site | Not found | Search/verify first. |
| New York | Office of the State Comptroller | https://www.osc.ny.gov/unclaimed-funds | Native state site | Not found | High priority, very large database; likely needs permitted access/public-records strategy. |
| North Carolina | Department of State Treasurer / NCCash | https://www.nccash.com | Native branded portal | Not found | High priority for data-access investigation. |
| North Dakota | Department of Trust Lands | https://www.land.nd.gov | Native state site | Not found | Search/verify first. |
| Ohio | Department of Commerce | https://www.com.ohio.gov | Native state site | Not found | High priority for data-access investigation. |
| Oklahoma | State Treasurer / OKTreasure | https://www.oktreasure.com | Native branded portal | Not found | Search/verify first. |
| Oregon | State Treasury | https://oregon.findyourunclaimedproperty.com | FindYourUnclaimedProperty portal | Not found | Search/verify first. |
| Pennsylvania | State Treasury / Bureau of Unclaimed Property | https://www.patreasury.gov/unclaimed-property/ | Native state site | Partial/aggregate OpenBookPA data; no confirmed owner/property bulk file | Explicit bot/AI warning for claims info/submissions. Use official/manual or data request path. |
| Rhode Island | General Treasurer / FindRIMoney | https://findrimoney.com | Native branded portal | Not found | Search/verify first. |
| South Carolina | State Treasurer | https://www.treasurer.sc.gov | Native state site | Not found | Search/verify first. |
| South Dakota | State Treasurer | https://southdakota.findyourunclaimedproperty.com | FindYourUnclaimedProperty portal | Not found | Search/verify first. |
| Tennessee | Department of Treasury | https://treasury.tn.gov | Native state site | Not found | Search/verify first. |
| Texas | Comptroller / ClaimItTexas | https://claimittexas.org | Native branded portal | Not found | Very high priority. Official portal may block automated reads; investigate data request/API/permission. |
| Utah | State Treasurer / MyCash | https://mycash.utah.gov | Native branded portal | Not found | Search/verify first. |
| Vermont | State Treasurer | https://www.vermonttreasurer.gov | Native state site | Not found | Search/verify first. |
| Virginia | Department of the Treasury / VA Money Search | https://vamoneysearch.org | Native branded portal | Not found | High priority for data-access investigation. |
| Washington | Department of Revenue | https://ucp.dor.wa.gov | Native state portal | Not found | High priority for data-access investigation. |
| West Virginia | State Treasurer | https://www.wvtreasury.com | Native state site | Not found | Search/verify first. |
| Wisconsin | Department of Revenue | https://www.revenue.wi.gov | Native state site | Not found | Search/verify first. |
| Wyoming | State Treasurer | https://statetreasurer.wyo.gov | Native state site | Not found | Search/verify first. |

## Practical CCC Roadmap

### 1. Keep California As The Main Scalable Engine

California remains the best proof-of-concept for the full CCC flywheel:

1. Download weekly CSV.
2. Stage import into a temporary/staging table.
3. Validate row count and source metadata.
4. Swap into active `source_records`.
5. Rebuild source-specific prospect index.
6. Run email enrichment only on saved/high-value leads.

### 2. Build A `source_catalogs` Expansion Model

For every state, add metadata fields before adding records:

- `source_key`
- `state`
- `agency`
- `official_url`
- `search_url`
- `data_access_type`: `bulk_csv`, `native_search`, `missingmoney`, `public_records_needed`, `manual`
- `bulk_url`
- `refresh_cadence`
- `terms_notes`
- `automation_risk`
- `last_researched_at`
- `ingestion_status`

### 3. Add "External State Search" Before Full Ingestion

For states without bulk data, CCC can still support a lead workflow:

- show the state official search link
- open MissingMoney/native portal in a new tab
- store manual verification notes
- attach screenshots or search result notes to the lead
- only ingest records when there is a lawful and reliable data source

### 4. Start Public-Records/Data-Access Outreach

For the highest-value states, send narrow records requests asking whether they provide:

- public owner/property extract
- API access
- scheduled data file
- finder/investigator access process
- published list of current unclaimed-property owners
- data dictionary and refresh cadence

Recommended first requests: Texas, New York, Florida, Illinois, Pennsylvania, New Jersey, Ohio, Washington, Virginia, North Carolina.

## Next Research Pass

The next pass should be state-by-state verification for the Tier 2 list only:

1. Capture screenshots of each search workflow.
2. Identify network/API endpoints where visible, without bypassing access controls.
3. Confirm whether terms prohibit automated access.
4. Draft a public-records request template.
5. Rank by commercial opportunity and technical feasibility.

