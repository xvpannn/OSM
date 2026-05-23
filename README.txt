OSM (Open Source Mapping) – Working Mechanism

1. Primary Objective
OSM is a platform that collects, processes, and presents financial data (e.g., SEC filings) and market signals centrally. Data is extracted from public sources, stored in a database, and presented via APIs and a UI accessible to analysts or other applications.
2. End-to-End Data Flow
3. Scraping
* The scraper.ts module (and scraper_uk.ts for UK data) fetches CSV/JSON filings from official websites (SEC, Companies House, etc.).
* Each process is executed asynchronously with SIGINT signal handling for clean shutdown.


4. Transformation & Normalization
* Raw data is cleaned, irrelevant columns are dropped, and data types are adjusted (e.g., dates to ISO-8601).
* The exportCSV function writes results to CSV files for database import.


5. Database Layer
* The hybrid driver in db.ts determines which backend to use:
* If the DATABASE_URL environment variable is present → use PostgreSQL (Supabase) via PostgresDbClient.
* Otherwise → use local SQLite.


* SQLite queries (e.g., INSERT OR IGNORE, PRAGMA) are automatically translated to PostgreSQL syntax (ON CONFLICT DO NOTHING, ignore PRAGMA).


6. Schema Migration
* Upon startup (initializeSystem in server.ts), the system checks the DB mode.
* If PostgreSQL → executes a unified schema migration creating user tables, sessions, filings, signals, and critical indexes.
* If SQLite → uses the existing schema in the .sqlite file.


7. API & UI
* The Express server (server.ts) exports RESTful endpoints such as /filings, /signals, and /auth.
* The front-end (web portfolio) consumes these endpoints to display interactive tables, charts, and search features.


8. Design Advantages

* Database Portability – Code can run with SQLite locally for rapid development or switch to PostgreSQL in production without altering business logic.
* Automated Query Translation – Users do not need to write different SQL for each DB; translateQuery and translateSchemaSql handle syntax differences.
* Signal & Filing Management – All financial data is centralized, facilitating historical analysis and AI model creation.
* Unified Migration Schema – When first run on PostgreSQL, the system automatically creates the complete schema and seeds the master account.

4. How to Add or Update the README
5. Edit the README.txt file with the text above or add other relevant sections.
6. Commit changes:
git add README.txt
git commit -m "Update README with OSM mechanism description"
7. Sync with remote GitHub:
git pull --rebase origin main   # ensure no conflicts
git push -u origin main

---

This document was created on 2026-05-23.
