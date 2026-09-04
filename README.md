# Revexa

Revexa is a chargeback evidence responder for Razorpay merchants. It listens for
dispute webhooks, uses an LLM agent to assemble and score evidence packets against
each dispute's reason code, and routes low-confidence cases to a human for review
before submission — turning a manual, deadline-driven chargeback process into a
mostly-automated one with a full audit trail.

## Stack

- **Client**: React (Vite) + Tailwind CSS
- **Server**: Node + Express, Socket.io
- **Database**: Postgres via Prisma
- **Agent**: Google Gemini API (`gemini-2.5-flash`)
- **Payments**: Razorpay Node SDK

## Project status

Day 1 of a 7-day build: repo scaffolding only. No webhook handling, agent logic,
or frontend pages yet.

## Setup

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment variables

```bash
cd server
cp .env.example .env
```

Fill in `.env` with your own values — see [server/.env.example](server/.env.example)
for the full list (Postgres connection string, Razorpay keys, Gemini API key, etc).

### 3. Run database migrations

```bash
cd server
npm run migrate
```

### 4. Seed the database

```bash
npm run seed
```

### 5. Run the server

```bash
npm run dev
```

The server starts on `http://localhost:4000` (override with `PORT`). Check
`GET /health` to confirm it's up and connected to Postgres.

### 6. Run the client

```bash
cd client
npm run dev
```

## Baseline ML Classifier

Alongside the Gemini-based `riskScorer` agent, the repo includes a genuinely
*trained* baseline classifier — a fitted `LogisticRegression`, evaluated on a
held-out test set it never saw during training. This is deliberately
separate from the agent (nothing in `riskScorer.js`, `evidenceAgent.js`, or
`GET /metrics` is touched by it) and exists for one reason: **an honest
train/test comparison, not just an accuracy number on the same population
the model was trained on.**

`GET /metrics` grades the LLM's zero-shot verdicts against every scored
dispute it has ever seen — a fair thing to report, but not the same claim as
"this model generalizes to data it hasn't seen." The baseline classifier
makes that second, stricter claim instead: an 80/20 stratified train/test
split, trained only on the 80%, graded only on the 20% it never trained on.
Precision, recall, the confusion matrix, and false-positive/false-negative
cost are computed with the exact same definitions `GET /metrics` uses (same
raw-amount-sum convention, mixed currencies and all), so the two numbers are
genuinely comparable rather than apples-to-oranges. See the "Baseline ML
Classifier" section on the Metrics page for both side by side.

### Reproducing it

Ground truth (`groundTruthDefensible`) and transaction context are both
populated independently of whether the Gemini call itself succeeds — so
generating training data doesn't require (or spend) Gemini quota. Aim for
comfortably more than ~150 usable rows with a reasonably balanced split
(not, say, worse than 85/15) before trusting the resulting numbers.

```bash
# 1. Generate more labeled data if needed (repeat as many times as you like —
#    each call is independent of Gemini quota/success):
curl -X POST http://localhost:4000/demo/trigger-dispute -H "Content-Type: application/json" -d '{}'

# 2. Export the dataset (from server/):
cd server
npm run export-dataset          # writes scripts/ml/dataset.csv

# 3. Train the classifier (from server/scripts/ml/, one-time venv setup):
cd scripts/ml
python -m venv venv
./venv/Scripts/activate         # Windows; use `source venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
python train_classifier.py      # writes model.joblib + ../../data/ml-metrics.json
```

The server never runs Python in production — `GET /metrics-ml` just reads
whatever `train_classifier.py` last wrote to `server/data/ml-metrics.json`
as a static file. Rerun the three steps above any time you want the number
to reflect more data.

### Threshold rationale

`CONFIDENCE_THRESHOLD`, `RISK_BAND_MARGIN`, and `HIGH_VALUE_CUTOFF`
(`server/.env`) are derived empirically by `scripts/ml/threshold_sweep.py`
against the same held-out test set the baseline classifier above uses, not
picked by hand. See [docs/threshold-rationale.md](docs/threshold-rationale.md)
for the method, the actual numbers, and an important caveat about the
baseline classifier's signal strength on the current synthetic dataset.

## Repo layout

```
revexa/
  server/
    src/
      routes/
      agents/
      lib/
      jobs/
      index.js
    prisma/
      schema.prisma
    scripts/
      export-dataset.js
      ml/
        train_classifier.py
        requirements.txt
        dataset.csv        (generated)
        model.joblib        (generated)
    data/
      ml-metrics.json        (generated)
  client/
    src/
      pages/
      components/
      hooks/
      lib/
```
