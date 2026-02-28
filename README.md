# Instant Wellness Kits (Sales Tax Compliance Engine)

**NOTE. Vercel does not support websockets for Neon Postgres. Http driver is not compatible with interactive transactions, so we failed to deploy the application in time.**

## 1. Problem Detail

**Instant Wellness Kits** transitioned from a college startup to a viral success overnight. By leveraging drone technology, the company provides ultra-fast "instant resets" to customers anywhere in New York State. However, the rapid operational scaling completely bypassed the legal requirement for sales tax collection.

**The Technical Challenge:**

Sales tax in New York is not a single flat rate. It is a composite rate made up of state, county, city, and special district taxes. Because drones deliver to exact GPS coordinates (latitude/longitude) rather than traditional street addresses or ZIP codes, traditional tax lookup tables based on ZIP codes are insufficient. ZIP codes often cross tax jurisdiction boundaries, leading to potential under-payment or over-payment.

The company had to implement a system that:

1. Takes GPS coordinates and a timestamp.
2. Identifies all overlapping tax jurisdictions.
3. Calculates a legally compliant composite tax rate.

## 2. Decision Log & Architecture

### 2.1. Usage of PostGIS

We chose PostGIS (an extension for PostgreSQL) as the core spatial engine.

- **Precision**: Unlike ZIP-to-tax mapping, which is prone to error, PostGIS allows us to perform "Point-in-Polygon" queries. This ensures that the exact coordinate of the drone delivery is matched against the precise geographic boundaries of counties, cities, and special districts.
- **Performance**: PostGIS utilizes GIST indexing, allowing the database to search through thousands of jurisdiction boundaries in milliseconds.
- **Standardization**: Using the geometry(MultiPolygon, 4326) type ensures we are using the global standard for GPS coordinates (WGS 84).

---

### 2.2. Logic of Calculating Composite Tax

The engine implements a hierarchical calculation logic to determine the final rate applied to an order.

#### 2.2.1. The Calculation Formula

The composite tax rate is determined by the following priority logic:

`CompositeRate = StateRate + LocalRate(City ∨ County) + SpecialRate`

**The Local Rate Logic**:

- **State Rate**: Always taken from the jurisdiction with level = 10.
- **City vs County**: Taken from the jurisdiction with level = 20 (County) or level = 30 (City) (_See Alignment with NYS Pub 718_).
- **Special Rate**: If the point falls within a jurisdiction with kind = SPECIAL (e.g., the Metropolitan Commuter Transportation District - MCTD), that rate is added to the total.

**Alignment with NYS Pub 718:**

This logic is strictly aligned with [_**NYS Publication 718**_](https://www.tax.ny.gov/pdf/publications/sales/pub718.pdf) (**New York State Sales and Use Tax Rates by Jurisdiction**). NYS law dictates that certain cities (like Yonkers or New Rochelle) "pre-empt" the county tax or add to it in specific ways. Our hierarchical "Level 30 > Level 20" logic mirrors how the state reports these taxes.

**Scalability Improvement:**

Currently, the formula is hardcoded to NYS logic. To make the application globally scalable, we could introduce a `TaxCalculationRules` table. This table would store logic for different regions (e.g., "In Texas, use [State + City + Transit]") allowing the code to remain generic while the database drives the regional logic.

---

### 2.3. Extensible Schema: Identifiers and Systems

We avoided hardcoding columns like `nys_reporting_code` or `fips_code` directly into the `jurisdictions` table. Instead, we implemented:

- `identifier_systems`: A table defining the type of ID (e.g., 'FIPS', 'NYS_CODE').
- `jurisdiction_identifiers`: A many-to-one mapping table.

**Why this is scalable:**

This allows a single jurisdiction to be identified by multiple systems simultaneously. For example, a county could have a Federal FIPS code for drone flight logs and a separate NYS Reporting Code for tax filings. If the company expands to New Jersey or international markets, we simply add a new "Identifier System" without changing the database schema. This decouples our geographic data from specific state-level bureaucratic naming conventions.

---

### 2.4. Temporal Data: effective_from and effective_to

Tax rates are not static; they change quarterly or annually.

- **Scenario Assumption**: As the company was recently founded, our current implementation focuses on current orders. Users cannot place backdated orders. Therefore, the data sourced from [_**Pub 718**_](https://www.tax.ny.gov/pdf/publications/sales/pub718.pdf) is sufficient for current operations.

- **Future-Proofing**: By including `effective_from` and `effective_to`, the system can handle future tax hikes or cuts automatically. When a rate changes, we simply insert the new rate with the correct date range. The engine will pick the rate where `OrderDate` falls between the "from" and "to" dates.

- **Historical Accuracy**: If we ever need to audit or process orders from the past, we would integrate [_**Pub 718-A**_](https://www.tax.ny.gov/pdf/publications/sales/pub718a.pdf) (**Enactment and Effective Dates of Sales and Use Tax Rates**). This would allow us to reconstruct exactly what the tax was on any given date in history, ensuring the company remains audit-proof as it grows.

---

### 2.5 External Tax Services

It is important to note that it would be significantly easier to use an external service like [**Avalara**](https://www.avalara.com/us/en/index.html) or [**Vertex**](https://www.vertexinc.com/).

- **Ease of Use**: These services handle the complex updates of tax laws, boundaries, and rates across thousands of jurisdictions automatically.
- **Decision Rationale**: In this startup scenario, building a custom PostGIS engine provided immediate cost savings and handled the specific drone-GPS coordinate requirement directly without requiring a standardized street address, which external APIs often demand.

## 3. Tech Stack

- **Full-stack Framework**: TanStack Start (React 19)
- **Routing**: TanStack Router (Type-safe)
- **Database**: PostgreSQL ([Neon Postgres](https://neon.com/)) with PostGIS extension
- **ORM**: Drizzle ORM
- **Authentication**: Better Auth
- **State Management**: TanStack Query (React Query)
- **Styling**: Tailwind CSS 4
- **UI Components**: Shadcn UI & Radix UI
- **Validation**: Zod
- **Server Engine**: Nitro
- **Runtime/Pkg Manager**: Bun
- **Deployment**: Vercel

## 4. Local Development Setup

Follow these instructions to get the Sales Tax Compliance Engine running on your local machine.

### 4.1. Prerequisites
* **Bun**: The project uses Bun as its runtime and package manager. [Install Bun](https://bun.com/docs/installation#windows).
* **PostgreSQL with PostGIS**: You must have a PostgreSQL instance (v14+) with the PostGIS extension installed.

--- 

### 4.2. Installation
1. Clone the repository:
```
git clone <repository-url>
cd int20h-test-case
```
2. Install dependencies:

`bun install`

3. Environment Variables:
Copy the example environment file (and input the correct values for each):

`cp .env.example .env`

---
### 4.3. Database Initialization
The engine relies on specific geospatial schemas and tax rate data to function.
1. **Run Migrations**: This sets up the tables, PostGIS extensions, and geospatial indexes.

`bun db:migrate`

2. **Seed the Database**: This is required to load the NYS tax jurisdictions, identifier systems (FIPS/NYS Codes), and the initial tax rates from the datasets/ directory.

`bun db:seed`

---
### 4.4. Running the Project
Start the development server:

`bun dev`
