# Revexa ![Uploading image.png…]()


**AI-assisted chargeback evidence response for Razorpay merchants.**

Built for the Razorpay AI Buildathon : Track 3, AI Revenue Recovery.
Deployed URL: [https://revexa-1.onrender.com/] 

Demo Video Link: [https://drive.google.com/file/d/1DljecSCn_UEBngugaTV7nC4izATpJeqN/view?usp=sharing]


---

## Table of contents

- [The problem](#the-problem)
- [What Revexa does](#what-revexa-does)
- [How This Aligns With the Project Requirements](#How-This-Aligns-With-the-Project-Requirements)
- [Innovation](#innovation)
- [System architecture](#system-architecture)
- [Guardrails — what "bounded and gated" actually means here](#guardrails)
- [Business value](#business-value)
- [Results](#results)
- [Completeness — the end-to-end experience](#completeness)
- [Limitations & scope](#limitations--scope)
- [What broke, and how we recovered](#what-broke-and-how-we-recovered)
- [Getting started](#getting-started)
- [Project structure](#project-structure)

---

## The problem

When a customer disputes a charge with their bank, the merchant has a short,
hard deadline , often 7 to 21 days to submit evidence proving the
transaction was legitimate. Miss it, or submit weak evidence, and the
merchant automatically loses the disputed amount plus a chargeback fee,
regardless of whether the transaction was actually fraudulent.

Doing this properly means assembling delivery confirmation, transaction
history, and customer communication into evidence that matches what the
card networks actually require , under time pressure, for every dispute
that comes in. Most merchants either miss the deadline or send generic
evidence that doesn't hold up.

Revexa automates the evidence-gathering and drafting work, and stops there
by design , a human always makes the final call before anything is
submitted.

## What Revexa does

1. A dispute arrives via a signature-verified, idempotent webhook.
2. An LLM-based risk scorer (Gemini) evaluates whether the case is
   defensible, returning a structured score and named signals — not a
   black-box number.
3. A separately **trained classifier** (logistic regression, fit on a
   held-out train/test split) independently scores the same case. If the
   two disagree, the case is automatically routed to human review rather
   than trusting either one alone.
4. For defensible cases, an evidence-drafting agent assembles a rebuttal,
   using evidence categories modeled on the actual card-network evidence
   requirements where those requirements are well-documented (see
   [Innovation](#innovation)).
5. Before anything reaches a human, a separate verification step checks
   that every piece of evidence the draft cites is actually supported by
   the underlying data,flagging the draft if it isn't.
6. A human reviews and approves or rejects. This is the only path to
   submission in the entire codebase, there is no auto-submit anywhere,
   at any confidence level.
7. Every step, by every actor (model, agent, or human), is written to an
   append-only audit trail.

---

## How This Aligns With the Project Requirements

| Criterion | Weight | Where to look |
|---|---|---|
| **Innovation** | 30% | Dual-model disagreement routing, evidence modeled on Visa's actual Compelling Evidence 3.0 rule, verification against underlying data rather than prompt-only anti-fabrication, empirically-derived (not guessed) threshold values — see [Innovation](#innovation) |
| **Technical Execution** | 30% | Every guardrail enforced server-side and independently verified (not just tested through the UI), automated test suite + CI, real-time architecture with no polling, idempotent webhook handling — see [System Architecture](#system-architecture) and [Guardrails](#guardrails) |
| **Business Value** | 20% | Concrete cost model (dispute amount + chargeback fee + reputational-risk proxy), money-defended and hours-saved figures computed from real data, not asserted — see [Business Value](#business-value) |
| **Completeness** | 20% | Full pipeline running live end to end, five polished pages, real-time updates throughout, deployed and smoke-tested on the actual production URL — see [Completeness](#completeness) |

---

## Innovation

**1. Two independent scoring methods, and their disagreement is itself a
signal.** Most AI-assisted review tools ship one model and ask you to
trust it. Revexa runs a prompted LLM and a separately fitted classifier
side by side. When they agree, that agreement is itself evidence the
decision is sound. When they disagree, the case is automatically pulled
into human review, using model disagreement as a risk signal, not just
displaying two numbers next to each other.

**2. Evidence modeled on actual network rules, not invented categories.**
For fraud-type disputes (Visa reason code 10.4), the evidence packet
implements Visa's real Compelling Evidence 3.0 requirement: two prior
undisputed transactions, 120–365 days old, matching at least two of four
data elements (user ID, IP address, shipping address, device ID), with at
least one match being IP or device ID. This qualification check runs in
code against the data, the LLM is told the qualification result, it
doesn't determine it. For other reason codes, evidence categories use
general industry terminology rather than asserting network-specific field
names we couldn't independently verify , an explicit choice to stay
accurate rather than sound more precise than we actually are.

**3. Anti-fabrication is verified, not just instructed.** The evidence
agent is told not to fabricate support for a case , but instructions alone
are not a guarantee. A separate, rules-based verification step checks
every artifact the draft cites against the underlying transaction data
after generation. If a draft cites delivery confirmation on a case where
delivery was never confirmed, the packet is flagged before a human ever
sees it , checked, not trusted.

**4. Threshold values are derived, not guessed.** `CONFIDENCE_THRESHOLD`,
`RISK_BAND_MARGIN`, and `HIGH_VALUE_CUTOFF` are each backed by a documented
empirical analysis in [`docs/threshold-rationale.md`](docs/threshold-rationale.md) — a
sweep across candidate threshold values against a held-out test set,
optimizing for total cost (false-positive cost + false-negative cost)
rather than raw accuracy, since cost is what actually matters for this
use case.

---

## System architecture

| Layer | Technology |
|---|---|
| Frontend | React (Vite) + Tailwind |
| Backend | Node.js + Express + Socket.io |
| Database | PostgreSQL + Prisma ORM |
| LLM | Gemini API (`@google/genai`) |
| Trained classifier | scikit-learn (offline training), plain-JS linear inference at request time |
| Payments | Razorpay Node SDK, test mode |
| Testing | Jest + Supertest |
| CI | GitHub Actions |
| Deployment | Railway/Render (backend), Vercel (frontend) |

<img width="428" height="466" alt="image" src="https://github.com/user-attachments/assets/427eaf22-665b-4f35-8775-03decca6577e" />

### Pipeline

```
Webhook received → signature verified → idempotency check
        ↓
Risk scorer (Gemini) scores + explains  ⟷  Trained classifier scores independently
        ↓                                            ↓
        └──────────────  disagreement? ──────────────┘
                              │
                     yes → pending_review
                              │
        no → score vs. threshold (in code, not in the prompt)
                              │
        ┌─────────────────────┴─────────────────────┐
   high confidence                            low confidence
        │                                             │
  evidence agent drafts                          marked "lost"
        │
  anti-fabrication check
        │
  human review (PIN + minimum dwell time enforced server-side)
        │
   approve → submitted          reject → lost
```

### Real-time layer

All live updates (Dashboard, Queue, Audit Trail) are pushed via Socket.io
at the moment a dispute's state actually changes — there is no polling
anywhere in this application. Verified by confirming two simultaneously
open browser tabs both update from a single triggered event, and by
confirming the client reconnects cleanly after a dropped connection.

### Data model

Three core tables — `Dispute`, `EvidencePacket`, `AuditLog` — plus derived
fields added as the guardrails matured: `confidenceScore`,
`classifierScore` and `classifierVerdict` (the independent trained-model
result), `verificationStatus` (anti-fabrication check outcome),
`reviewStartedAt` (server-enforced dwell timer), and `groundTruthDefensible`
(used only for offline grading — never passed to either scoring model).

---

## Guardrails

Every claim below was independently verified against the running code, not
just assumed from the implementation plan:

- **No code path can submit a dispute without a human approval.** Confirmed
  by grep across the entire routes directory, not just by testing the
  intended flow.
- **The confidence threshold lives in an environment variable, not the
  LLM prompt.** The model cannot see or influence it.
- **Double-approval is rejected.** A second `/approve` call on an
  already-processed dispute returns `409`, verified directly, not inferred.
- **The reviewer PIN and minimum-dwell-time checks are enforced
  server-side**, confirmed by bypassing the UI entirely and hitting the
  API with a raw request before the countdown finished and with an
  incorrect PIN , both rejected.
- **Failure degrades gracefully.** LLM calls retry with backoff; on final
  failure, the dispute is routed to a `needs_attention` state rather than
  crashing or silently disappearing.
- **Webhook handling is idempotent**, verified by replaying an identical
  signed payload and confirming no duplicate record is created.
- **The audit log is append-only**  no update or delete path exists for
  any `AuditLog` row.
- **Defense-only scope.** Revexa drafts rebuttals from a merchant's own
  already-collected transaction data to contest a chargeback. It does not
  scan, probe, or interact with any system outside this merchant's own
  dispute data.

---

## Business value

- What Razorpay already has: a self-serve Dispute Dashboard where merchants can view, accept, or contest disputes and upload evidence, plus real-time webhook notifications when a dispute is filed. Merchants are also advised to check the dashboard daily so chargebacks aren't missed via email. On the prevention side, Razorpay Shield uses an AI/ML risk engine checking transactions against 100+ rules to reduce fraudulent chargebacks before they happen. And on the highest-touch end, Razorpay's own chargeback experts help build the strongest possible case for merchants, submitting evidence before deadlines 100% of the time, which has cut resolution time by up to 25%. 

- Where that leaves a real gap , and it's the one Revexa fills: everything above is either tracking/submission infrastructure (the dashboard, the webhooks) or pre-transaction risk scoring (Shield). None of it is AI-assisted evidence assembly at the moment a dispute lands , that step is still manual merchant effort, or it's Razorpay's own human experts doing bespoke work per case. Human expert review doesn't scale evenly across millions of merchants of wildly different sizes; a small merchant fighting a ₹2,000 dispute isn't getting the same white-glove treatment as an enterprise account. That's specifically the gap Revexa targets: automated triage (is this worth fighting at all) plus automated, network-rule-aware evidence drafting, with a human only reviewing the output instead of building it from scratch.

**Why that's valuable to Razorpay specifically, not just to one merchant:**


- It's a force multiplier for the expert team that already exists, not a replacement pitch. Position this as "what if every merchant's dispute got the triage and evidence-assembly quality currently reserved for high-touch accounts" , that's an internal efficiency story for Razorpay's own operations, not just a merchant-facing feature.
  
- It compounds with Shield rather than duplicating it. Shield stops fraud before the transaction; Revexa handles what happens after a dispute is filed anyway , legitimate transactions that get disputed regardless of how good pre-transaction screening is. Different stage of the same problem, genuinely complementary.
  
- The 25% resolution-time figure becomes your benchmark, not your competitor. If a merchant's evidence is auto-assembled the moment a dispute lands instead of waiting in a queue for manual attention, there's a real argument this improves on that existing number — worth saying carefully as "a potential improvement on" rather than claiming it outright, since you haven't measured against Razorpay's real pipeline.


---

## Results

**ML Model (Classifier): Results**

| Metric | Result |
|--------|--------|
| Test Set Size | 7 |
| Precision | 0.50 |
| Recall | 0.75 |

**Gemini Model : Scoring metrics**

### 1. Scoring

The Gemini model generates a `verdict` indicating whether a dispute is **defensible**. Its predictions are compared against the `groundTruthDefensible` label.

#### Confusion Matrix Terms

| Term | Meaning |
|------|---------|
| **TP (True Positive)** | Gemini predicted `defensible` and the dispute was actually defensible. |
| **FP (False Positive)** | Gemini predicted `defensible`, but the dispute was not actually defensible. |
| **FN (False Negative)** | Gemini predicted `not defensible`, but the dispute was actually defensible. |
| **TN (True Negative)** | Gemini predicted `not defensible` and the dispute was actually not defensible. |

#### Metrics

| Metric | Formula | Meaning |
|--------|---------|---------|
| **Precision** | `TP / (TP + FP)` | Of all disputes Gemini marked as defensible, how many were actually defensible. |
| **Recall** | `TP / (TP + FN)` | Of all actually defensible disputes, how many Gemini correctly identified. |
| **False-Positive Cost** | `Σ (dispute.amount + CHARGEBACK_FEE)` | Total cost of pursuing disputes incorrectly classified as defensible. |
| **False-Negative Cost** | `Σ dispute.amount` | Total amount lost by failing to contest disputes that were actually defensible. |

> **Note:** No representment fee is included in the false-negative cost because the dispute was never filed.

### 2. Evidence Drafting & Verification

The Gemini-generated evidence packets are processed through `evidenceAgent.js` and checked by `verifyEvidence.js`.

The verification step helps prevent AI-generated letters from making unsupported claims or citing evidence that contradicts the underlying dispute data.

| Metric | Formula | Meaning |
|--------|---------|---------|
| **Verified Rate** | `Verified Packets / Total Drafted Packets` | Percentage of generated evidence packets that passed verification. |
| **Flagged Rate** | `Flagged Packets / Total Drafted Packets` | Percentage of packets where the fact-checker detected an issue. |
| **Flagged Rate** | `1 − Verified Rate` | Equivalent calculation when every packet is either `verified` or `flagged`. |

A packet is considered **verified** when its `verificationStatus` is `"verified"`.

A packet is **flagged** when its `verificationStatus` is `"flagged"`, meaning the rules-based verifier detected a potential contradiction or unsupported claim.




---

## Completeness

Five pages, all live-updating via the same real-time event stream:

- **Dashboard** : money at risk/defended/lost, win rate, live activity
  feed, both models' precision/recall/cost figures, business-value
  projection.
- **Queue** : every dispute, sortable, with a live SLA countdown per row.
- **Dispute Detail** : a slide-over drawer with the full risk assessment
  (score against threshold, structured signals, CE 3.0 breakdown where
  applicable), the evidence packet with cited artifacts highlighted, and
  the gated approve/reject actions.
- **Audit Trail** : every action, by every actor, chronologically.
- **Metrics** : both scoring methods' honest performance, side by side.

Deliberately out of scope: login/signup (a shared reviewer PIN plus
server-enforced dwell time substitutes for full auth at MVP scope — see
below), Redis-backed job queues, and monitoring/alerting infrastructure,
none of these demonstrate agent judgment, which is what this build is
actually about.

---

## Limitations & scope

Stated plainly, not defensively:

- The reviewer PIN is a shared secret for MVP scope, not per-user
  authentication. In production this would be role-gated to named,
  authenticated reviewers.
- All dispute data in this build is synthetic, generated to be internally
  consistent, not live transaction traffic.
- The Compelling Evidence 3.0 mapping is sourced from Visa's published
  rule specifically for reason code 10.4. Other reason codes use general
  industry evidence categories that have not been separately verified
  against Mastercard's specific taxonomy.
- The reputational-risk dispute-ratio warning threshold is illustrative
  and configurable via an environment variable, it is not presented as a
  verified, current Visa or Mastercard monitoring-program figure.
- The business-value projection uses explicitly labeled assumed rates
  (monthly dispute volume, hourly ops cost), not Razorpay-provided data.

## What broke, and how we recovered

- Prisma Migration Issue: prisma migrate dev detected differences between the actual database and Prisma’s migration history and offered to reset the entire database, which could have deleted existing demo data. This happened because some previous migrations had been applied manually using SQL but were never recorded in Prisma’s _prisma_migrations table. We cancelled the reset, manually applied the required ALTER TABLE changes, and added the missing migration records so the database and Prisma’s migration history were consistent again.
- Classifier Training Issue: train_classifier.py crashed because the database had only four labeled disputes, with one class having only a single example, which was not enough for scikit-learn to perform a stratified train/test split. We generated 30 additional synthetic disputes using the existing demo endpoint, bringing the total to 33 labeled examples with a balanced 54.5%/45.5% class distribution, and then retrained the classifier successfully.
- Classifier Numerical-Mismatch Risk: The JavaScript implementation of the classifier could potentially produce incorrect scores if its mathematical calculations differed slightly from the original scikit-learn model, without causing any obvious error. To make sure it was correct, we passed the same input through both the Python predict_proba() model and the JavaScript implementation and confirmed that both produced exactly 0.5496517716670433, proving that the JS implementation matched the Python model.
- Postgres/Jest Crash: Jest was intermittently crashing with TypeError: Cannot read properties of undefined (reading 'isIP'), even though the error appeared in unrelated test files. The actual problem was that /approve intentionally starts the Razorpay submission in the background without awaiting it, and that background operation could still perform a database query while another test was running prisma.$disconnect(). We fixed the race condition by adding a short settle buffer before disconnecting Prisma in the shared test teardown, giving any remaining background database operations enough time to finish before Jest destroyed the environment.
- Webhook Test Issue: webhookSignatureRejection.test.js returned 400 instead of the expected 200 for a valid signed request because Supertest was changing a Buffer into JSON when .send(Buffer) was used together with Content-Type: application/json, which corrupted the exact request bytes used for signature verification. We confirmed this with a minimal Express/Supertest reproduction and fixed the test by sending the raw string instead of a Buffer.
- GitHub Actions npm ci Issue: GitHub Actions failed during npm ci because server/package-lock.json was out of sync with package.json, with missing versions of transitive optional dependencies such as @emnapi/core, which were pulled in through pdf-lib. We reproduced the failure locally, regenerated the lock file using npm install, verified that a clean npm ci worked, and finally confirmed the fix on an actual GitHub Actions run.
- Gemini Model Issue: New Gemini API keys returned a 404 when the project tried to use gemini-2.5-flash because that model was no longer accepted for those keys. The project’s existing riskScorer.js documentation identified the newer supported model, gemini-3.6-flash, so the implementation uses that model instead. This was based on existing project documentation rather than a problem personally discovered during this debugging work.

---

## Getting started

```bash
git clone https://github.com/chs018/Revexa
cd revexa

# Backend
cd server
cp .env.example .env   # fill in real values — never commit .env
npm install
npx prisma migrate dev
npm run seed
npm run dev

# Frontend, in a second terminal
cd client
npm install
npm run dev
```

Run the test suite: `cd server && npm test`

## Project structure

```
revexa/
  server/
    src/
      routes/          webhook, disputes, demo, review-gating endpoints
      agents/           riskScorer.js, evidenceAgent.js, verifyEvidence.js
      lib/               prisma, socket, signature verification, PIN check
      jobs/              concurrency-limited scoring pipeline
    scripts/ml/         classifier training, threshold sweep
    prisma/             schema + migrations
    docs/               threshold-rationale.md
  client/
    src/
      pages/            Dashboard, Queue, AuditTrail, Metrics
      components/       DisputeDetail and shared UI
      hooks/            useSocket
  .github/workflows/    CI
```
