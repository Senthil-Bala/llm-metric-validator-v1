# LLM Metric Validator (MetricCheck)

**Measuring Numerical Reliability and Testing a Grounded Safeguard for LLM Analytics**

MetricCheck is a beginner-friendly JavaScript/Node.js prototype for studying whether LLMs produce incorrect or inconsistent analytics numbers when calculating directly from data, and for testing a grounded alternative: calculate metrics with deterministic code, ask the LLM to summarize them, and validate its numerical claims against the independent calculations.

> **In one sentence:** test direct LLM calculation for numerical errors and repeat-to-repeat variation, then evaluate whether software-calculated reference metrics and independent claim validation can act as a practical safeguard.

## 1. Project objective

MetricCheck investigates a practical reliability problem: **when an LLM calculates analytics directly from source data, its numerical answers may be incorrect or vary across repeated runs.** The objective is to measure whether and under what data, metric, prompt, and model conditions these errors and inconsistencies occur, and to evaluate a grounded safeguard that uses deterministic software for arithmetic and checks the LLM's claims independently.

The project is not designed to assume that the LLM will fail. It tests the concern fairly: include straightforward and challenging but realistic tasks, keep reference answers independent, repeat the same conditions, and report successful as well as unsuccessful outputs. If the model remains accurate on a broader test set, that is a valid result too.

MetricCheck compares two approaches: asking the LLM to calculate from source rows (`direct`) and asking it to summarize software-calculated values (`grounded`). In both modes, locally calculated reference metrics are used to validate structured claims. This both measures the direct-calculation risk and tests whether deterministic calculation plus claim validation provides a useful response-level safeguard; it does not assume the safeguard will work for every task or model.

The initial pilot was too simple to demonstrate the motivating concern: it used one small synthetic dataset, one model, 18 requests, and prompt variants that changed only their opening sentence. All 72 structured claims matched. A later preliminary test of the opt-in 400-row dataset found a different result: in 18 successful requests, all 99 grounded claims matched, while all 99 direct-mode claims mismatched; all 11 direct metrics varied across the three repetitions for each prompt strategy. This is evidence of errors and run-to-run variation for this particular task and model configuration, not a general estimate of LLM reliability. Both results are reported rather than selected to support a preferred conclusion. MetricCheck is an exploratory prototype, not a production analytics system or validated benchmark. The current evaluator checks structured JSON claims, not every number in prose.

### Why is a checker useful when some pilot runs are correct?

A correct answer on one small dataset does not guarantee correctness on a new dataset, a more complex calculation, a changed prompt, or a later model version. The 400-row test found wrong, varying numbers in direct mode while grounded-mode claims matched in those trials. A deterministic checker can validate each answer against trusted calculations, flag missing or incorrect values, and retain an auditable record. More datasets and model settings are needed to determine where this safeguard helps.

## 2. How the comparison works

MetricCheck reads daily rows from an Excel workbook and calculates reference metrics locally. The experiment runner sends one of two inputs to the configured LLM:

| Mode | What the model receives | What the model is asked to do |
|---|---|---|
| `direct` | The synthetic daily rows and the requested metric names/definitions | Calculate the metrics from the rows and write a summary |
| `grounded` | The metric values already calculated by JavaScript | Summarize the supplied values without recalculating |

Both modes use the same selected prompt wording. The LLM must return JSON containing a prose `summary` and a list of structured `claims`. MetricCheck compares each claim with the local reference values. The same source workbook and reference values are used to evaluate both modes.

```text
Synthetic Excel workbook
        |
        v
workbook.js loads and validates the daily rows
        |
        v
metrics.js calculates trusted reference metrics
        |
        +----------------------------+
        |                            |
        v                            v
direct: send daily rows       grounded: send metrics
        |                            |
        +-------------+--------------+
                      v
             LLM returns JSON
                      |
                      v
       claims.js checks numeric claims
                      |
                      v
   experiment.js builds JSON results and totals
```

In the `direct` mode the LLM receives the synthetic rows; in `grounded` mode it receives only the locally calculated metrics. The experiment always keeps the reference calculations local.

## 3. What the current sample data calculates

The workbook is generated from [sample-engagement.json](./data/sample-engagement.json). It contains eight synthetic daily records across January and February 2026. There are four dates in each month; the data intentionally does not represent every calendar day.

| Metric key | Definition | Reference value |
|---|---|---:|
| `total_app_opens` | Sum of `app_opens` over the supplied rows | 1,079 |
| `monthly_avg_daily_app_opens_2026_01` | Mean of January `app_opens` rows present in the workbook | 125 |
| `monthly_avg_daily_app_opens_2026_02` | Mean of February `app_opens` rows present in the workbook | 144.75 |
| `notification_open_rate_percent` | Total notifications opened ÷ total notifications sent × 100, rounded to two decimals | 41.95% |

The notification open rate is weighted across all rows; it is not the average of each day's percentage. Monthly averages divide by the number of rows present for that month, not by the number of calendar days in the month.

## 4. Beginner setup

### Requirements

- Node.js 18 or newer
- npm
- An LLM API key is optional for the API's health and claim-validation endpoints. It is required to generate summaries or run an LLM comparison.

### Install, create the workbook, and run tests

```bash
cd ~/metriccheck
npm install
npm run sample:workbook
npm test
```

`npm run sample:workbook` creates `data/sample-engagement.xlsx` from the checked-in synthetic JSON input. It can be run again whenever you want to recreate the workbook.

### Configure an LLM provider (optional)

The project supports Gemini and DeepSeek. Provider model availability, pricing, quotas, and data-use terms can change; check the provider's current documentation before use:

- [Google AI Studio](https://aistudio.google.com/apikey)
- [DeepSeek platform](https://platform.deepseek.com/)

Copy the template and fill in the values for **one** provider:

```bash
cp .env.example .env
```

For DeepSeek, set `LLM_PROVIDER=deepseek`, `DEEPSEEK_API_KEY`, and `DEEPSEEK_MODEL`. For Gemini, set `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL`. If `LLM_PROVIDER` is omitted, the code defaults to Gemini. `.env` is ignored by Git; do not put real API keys in `.env.example` or commit them.

The API and experiment runner load `.env` automatically. If provider configuration is missing, local metric calculation and `/api/validate` still work; summary generation returns a configuration error.

### Start the local API

```bash
npm start
```

The service listens on `http://localhost:3000` by default and binds to `127.0.0.1`. The startup output prints the calculated metrics. You can override the port with `PORT` or the workbook path with `WORKBOOK_PATH`.

Check that it is running:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{"status":"ok"}
```

## 5. API guide

The API is a small local Koa service. It has a health check and two POST endpoints.

### `GET /health`

No parameters or request body are required.

```bash
curl http://localhost:3000/health
```

Returns HTTP 200 and `{ "status": "ok" }` when the service is responding.

### `POST /api/validate`

This endpoint checks caller-provided claims against the metrics already calculated when the server started. It does **not** call an LLM.

**Input parameters**

| Field | Type | Requirement |
|---|---|---|
| `claims` | Array of objects | Required; must contain at least one item |
| `claims[].metric` | String | Required; trimmed and must not be empty |
| `claims[].value` | Number | Required |

Example request with one correct claim and one intentionally incorrect claim:

```bash
curl -X POST http://localhost:3000/api/validate \
  -H 'content-type: application/json' \
  -d '{
    "claims": [
      { "metric": "total_app_opens", "value": 1079 },
      { "metric": "notification_open_rate_percent", "value": 40 }
    ]
  }'
```

Example response for the current sample workbook:

```json
{
  "actualMetrics": {
    "total_app_opens": 1079,
    "notification_open_rate_percent": 41.95,
    "monthly_avg_daily_app_opens_2026_01": 125,
    "monthly_avg_daily_app_opens_2026_02": 144.75
  },
  "results": [
    {
      "metric": "total_app_opens",
      "claimedValue": 1079,
      "expectedValue": 1079,
      "difference": 0,
      "status": "MATCH"
    },
    {
      "metric": "notification_open_rate_percent",
      "claimedValue": 40,
      "expectedValue": 41.95,
      "difference": 1.95,
      "status": "MISMATCH"
    }
  ],
  "summary": {
    "total": 2,
    "matches": 1,
    "mismatches": 1,
    "unknownMetrics": 0
  }
}
```

An unrecognized metric key receives `UNKNOWN_METRIC`. The default numeric tolerance is `0.01`: a claim is a `MATCH` when the absolute difference from the expected value is no more than that amount. Joi request-shape errors return HTTP 400.

### `POST /api/generate-summary`

This endpoint takes no request body. It sends the locally calculated metrics to the selected provider, receives a summary plus structured claims, and validates those claims locally.

```bash
curl -X POST http://localhost:3000/api/generate-summary
```

Response shape:

```json
{
  "summary": "App opens totaled 1,079.",
  "validation": {
    "results": [
      {
        "metric": "total_app_opens",
        "claimedValue": 1079,
        "expectedValue": 1079,
        "difference": 0,
        "status": "MATCH"
      }
    ],
    "summary": {
      "total": 1,
      "matches": 1,
      "mismatches": 0,
      "unknownMetrics": 0
    }
  }
}
```

This route sends calculated metric values, not the workbook's daily rows. It requires the selected provider's API key and model. The provider response must contain non-empty summary text and at least one structured claim. Transient network/provider failures are retried up to two times after the first attempt (three attempts maximum); each request attempt has a 20-second timeout. The server logs structured progress/failure events and does not log the API key or prompt.

## 6. Run the direct-versus-grounded experiment

The command-line runner has five standard tasks and an opt-in 400-row synthetic engagement task. Every task has a locally calculated reference answer and can be repeated under selected modes and prompt strategies. The runner writes a detailed JSON report beneath `reports/experiments/`, including the exact prompt and input used for each request.

### Inputs and command-line parameters

```bash
npm run experiment -- [options]
```

| Option | Meaning | Default | Allowed values |
|---|---|---|---|
| `--runs <n>` | Repetitions for every selected task, strategy, and mode | `3` | Integer 1–10 |
| `--tasks <ids>` | Comma-separated benchmark task IDs | All five tasks | See task list below |
| `--variants <ids>` | Comma-separated prompt strategy IDs | `concise,formula-led,self-check` | `concise`, `formula-led`, `self-check` |
| `--modes <names>` | Comma-separated modes to run | `grounded,direct` | `grounded`, `direct` |
| `--help` | Print usage and available options | — | — |

Available benchmark tasks:

| Task ID | Category | What it tests |
|---|---|---|
| `simple-total-average` | Baseline | Total and mean |
| `weighted-notification-rate` | Aggregation | Weighted rate versus average of daily rates |
| `segment-filter` | Filtering | Filter by segment, then calculate separate metrics |
| `monthly-grouping` | Grouping | Group dates by month and average observed rows |
| `month-over-month-change` | Multi-step | Aggregate by month, then calculate percentage change |
| `synthetic-engagement-400` | Large multi-step | 400 daily-by-platform rows, daily averages after combining platforms, weighted notification rate, platform/region/campaign filters, monthly totals, and month-to-month change. Opt-in because direct prompts include all 400 rows. |

The three current prompt strategies are materially different: `concise` minimizes extra guidance, `formula-led` emphasizes applying definitions and units, and `self-check` explicitly asks the model to verify its calculations/claims. Their exact mode-specific wording is archived in each new experiment report. The 400-row task is deliberately excluded from the default task selection to avoid unexpectedly increasing prompt size, request volume, and cost.

### Generate the 400-row dataset

The reproducible dataset has 100 consecutive dates (2026-01-01 through 2026-04-10) and four platform rows per date. Each row has date, platform, region, campaign, app opens, active users, notifications sent, and notifications opened. It includes a zero-notifications row to exercise rate handling. The checked-in files are synthetic and generated with a fixed seed:

```bash
npm run data:large:generate
```

This recreates [JSON](./data/synthetic-engagement-400.json), [CSV](./data/synthetic-engagement-400.csv), and [Excel](./data/synthetic-engagement-400.xlsx) copies. The matching benchmark task calculates reference metrics locally. Its current reference values include 367,535 total app opens, a 35.14% weighted notification open rate, 88,977 Android app opens, and monthly totals for January through April. See the task definitions and tests for the full reference set.

Provider selection, credentials, optional `LLM_TEMPERATURE` (0–2), and optional `LLM_REQUEST_TIMEOUT_MS` (1,000–120,000; default 20,000) come from `.env` or the process environment. Keep generation settings fixed for comparisons; omitted temperature uses the provider default. Large direct-mode prompts may need a higher request timeout. Each report records provider, model, temperature, task/mode/strategy selections, reference values, exact prompts and inputs, every successful or failed run, and aggregated results. Grounded mode sends only trusted metrics plus the task description/definitions; direct mode sends the synthetic task rows and definitions.

Examples:

```bash
# Defaults: 5 tasks x 3 strategies x 3 runs x 2 modes = 90 summary requests
npm run experiment

# Quick, narrow pilot: one challenge task, two strategies, one repetition, both modes
npm run experiment -- --runs 1 \
  --tasks weighted-notification-rate \
  --variants concise,formula-led \
  --modes grounded,direct

# 400-row task, one repetition per strategy/mode = 18 requests
npm run experiment -- --runs 1 \
  --tasks synthetic-engagement-400 \
  --modes grounded,direct

# Test all tasks with ten repeated runs per condition
npm run experiment -- --runs 10

# Show all options
npm run experiment -- --help
```

The runner is sequential. The standard benchmark has five tasks, three strategies, and two modes; the cap is ten runs per condition (300 scheduled requests), before provider retries. The default experiment makes 90 summary requests. The 400-row task adds 18 requests when run with three strategies, both modes, and one repetition; its direct-mode prompts are much larger than the standard tasks. Check provider quotas/cost before running it. No live model run is triggered by the test suite. If one summary request fails, its error is saved and remaining scheduled runs continue; the command exits unsuccessfully if the report contains failed requests.

### What the report counts

- **Request/run:** one scheduled model summary for one mode, prompt variant, and run number.
- **Matching claim:** a reported structured metric value is within the validator's tolerance of the reference value.
- **Mismatching claim:** a known metric was returned with a value outside tolerance.
- **Unknown metric claim:** a response names a metric not in the reference metrics.
- **Missing metric claim:** an expected metric was not included in the response. This is counted by the experiment evaluator.
- **Accuracy:** matching claims divided by all checked claims, including mismatch, unknown, and missing claims.
- **Metric consistency:** whether the same structured metric value changed across repeated runs for the same task, mode, and prompt strategy.

Each result also stores the generated prose. The aggregate statistics do not prove that the prose is complete, logically correct, or faithfully reflects all the structured claims.

## 7. Completed initial pilot (historical)

The initial pilot was run on **2026-11-18** using one small synthetic workbook, provider `deepseek`, model `deepseek-flash`, three minor prompt-framing variants, three runs per variant, and both modes. This produced 18 successful summary requests and checked four metric claims per response.

### Overall by mode

| Mode | Requests | Successful | Failed | Claims checked | Claims matched | Mismatched | Unknown | Missing | Accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `grounded` | 9 | 9 | 0 | 36 | 36 | 0 | 0 | 0 | 100% |
| `direct` | 9 | 9 | 0 | 36 | 36 | 0 | 0 | 0 | 100% |
| **Total** | **18** | **18** | **0** | **72** | **72** | **0** | **0** | **0** | **100%** |

### By prompt variant

| Mode | Prompt variant | Runs | Successful | Failed | Claims matched | Mismatched | Unknown | Missing | Accuracy |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `grounded` | `executive-brief` | 3 | 3 | 0 | 12/12 | 0 | 0 | 0 | 100% |
| `grounded` | `analytics-review` | 3 | 3 | 0 | 12/12 | 0 | 0 | 0 | 100% |
| `grounded` | `leadership-update` | 3 | 3 | 0 | 12/12 | 0 | 0 | 0 | 100% |
| `direct` | `executive-brief` | 3 | 3 | 0 | 12/12 | 0 | 0 | 0 | 100% |
| `direct` | `analytics-review` | 3 | 3 | 0 | 12/12 | 0 | 0 | 0 | 100% |
| `direct` | `leadership-update` | 3 | 3 | 0 | 12/12 | 0 | 0 | 0 | 100% |

The request-level CSV and Excel exports from this historical pilot are not included in the public repository. The detailed generated JSON report is also kept local because it contains full model prompts and outputs.

Regenerate these examples from the saved JSON report with:

```bash
npm run experiment:export
```

Or specify a different saved experiment report:

```bash
npm run experiment:export -- reports/experiments/experiment-YYYY-MM-DDTHH-MM-SS.sssZ.json
```

New benchmark reports archive exact prompts and inputs when each request runs. The exporter uses those archived values. For older pilot reports, it reconstructs the prompt using the original report values, workbook, and current prompt-builder code, so that reconstruction depends on the code/data remaining compatible.

**Important for the historical pilot:** `executive-brief`, `analytics-review`, and `leadership-update` differ only in their opening sentence. The new benchmark instead uses `concise`, `formula-led`, and `self-check`, which have meaningfully different calculation/verification instructions. Their results must come from a fresh experiment and must not be inferred from the historical pilot.

**Interpretation:** this small pilot did not demonstrate the inconsistency that motivated the project. There was one dataset, one configured model, three small framing variants, and three repetitions per variant per mode. The newer 400-row benchmark tests more involved calculations and repeats identical conditions; only the measured results can show whether errors or variation occur.

## 8. Expanded benchmark run

The expanded benchmark was subsequently run on **2026-11-18** using five synthetic task types, three substantive prompt strategies, both modes, and three repetitions per condition with `deepseek-flash`. All **90/90** requests succeeded. Across **198** structured numeric claims, **198 matched**; there were **0 mismatches, 0 unknown metrics, and 0 missing claims**. None of the 66 task/mode/strategy/metric groups varied across their repeated runs.

| Task | Category | Requests | Correct claims | Mismatch / unknown / missing |
|---|---|---:|---:|---:|
| `simple-total-average` | Baseline | 18/18 | 36/36 | 0 / 0 / 0 |
| `weighted-notification-rate` | Aggregation | 18/18 | 36/36 | 0 / 0 / 0 |
| `segment-filter` | Filtering | 18/18 | 36/36 | 0 / 0 / 0 |
| `monthly-grouping` | Grouping | 18/18 | 36/36 | 0 / 0 / 0 |
| `month-over-month-change` | Multi-step | 18/18 | 54/54 | 0 / 0 / 0 |

The detailed generated JSON report and request-level exports are kept locally and excluded from the public repository because they contain full model prompts and outputs.

**Did this run demonstrate the original objective? No.** It found no structured-claim error or run-to-run variation under the tested conditions. The benchmark is broader than the first pilot, but each task still has only a few rows, only one model configuration was used, and the model's prose was not independently audited for every numeric statement. The result is a genuine negative finding for this test set, not evidence that LLMs never produce errors. The next experiment should add more and varied datasets, additional boundary cases, and—if feasible—another model/configuration. It should preserve the same-task repeated-run design and report outcomes regardless of direction.

## 9. Preliminary 400-row comparison

On **2026-11-19**, the opt-in 400-row synthetic task was run with `deepseek-flash`, three prompt strategies (`concise`, `formula-led`, `self-check`), both modes, and three repetitions per condition. DeepSeek thinking was explicitly disabled to avoid the unreadable/timeout responses seen in earlier direct-mode attempts; temperature remained at the provider default. All **18/18** requests succeeded.

| Mode | Requests | Successful | Failed | Claims checked | Matched | Mismatched | Metrics varying across repeats |
|---|---:|---:|---:|---:|---:|---:|---:|
| `grounded` | 9 | 9 | 0 | 99 | 99 | 0 | 0/33 |
| `direct` | 9 | 9 | 0 | 99 | 0 | 99 | 33/33 |

Grounded outputs matched the same 11 reference metrics on every repetition. In direct mode, every claim was wrong in every run, and each metric changed across the three repetitions within each of the three prompt strategies. For example, the expected total was **367,535** app opens; `concise` direct-mode runs reported **348,864**, **359,931**, and **328,101**. This run therefore demonstrates both inaccuracy and repeat-to-repeat variation under this one task/model/configuration. It does not show how often this occurs on other data, models, or settings, and the structured-claim evaluator still does not audit all prose. Earlier direct attempts with thinking enabled failed to return parseable responses; those provider failures are excluded from the claim counts.

The detailed generated JSON report is kept locally and excluded from Git because it contains full model prompts and outputs. The measured values for all direct-mode repetitions are in the [direct-mode results CSV](./reports/experiments/direct-mode-results.csv), and grounded-mode values are in the [grounded-mode results CSV](./reports/experiments/grounded-mode-results.csv).

## 10. Repository walkthrough: start with the app

### Request startup flow

1. [`src/index.js`](./src/index.js) is the process entry point. It loads `.env`, selects the workbook path, loads the spreadsheet, calculates metrics, checks the port, creates the app, and starts the local HTTP server.
2. [`src/app.js`](./src/app.js) creates the Koa application. It installs top-level error handling, parses JSON request bodies, puts the pre-calculated metrics on `ctx.state`, and mounts the router.
3. [`src/routers/analysis.js`](./src/routers/analysis.js) defines the health route and the two API routes. Joi validates the `/api/validate` body before the request reaches its handler.
4. Route handlers call the service modules to validate claims or generate an LLM summary.

### `src/services/`

| File | Responsibility |
|---|---|
| [`workbook.js`](./src/services/workbook.js) | Reads the Excel workbook. Checks required sheet names and headers, parses dates and non-negative integer counts, rejects duplicate/missing date rows and opened counts above sent counts, joins daily engagement with notification data by date, and returns sorted daily rows. |
| [`metrics.js`](./src/services/metrics.js) | Calculates total app opens, each observed month's average daily app opens, and the weighted notification open rate. It rounds averages and the percentage to two decimal places. |
| [`claims.js`](./src/services/claims.js) | Compares reported metric names and numeric values with reference values. Returns per-claim status, expected value and difference when known, plus totals. Its default tolerance is `0.01`. |
| [`llm.js`](./src/services/llm.js) | Builds a prompt, calls Gemini or DeepSeek, applies request timeouts and bounded retries, parses the response JSON, and validates the required `{ summary, claims }` structure with Joi. |
| [`promptVariants.js`](./src/services/promptVariants.js) | Defines three materially different prompt strategies and builds mode-specific prompts for `direct` and `grounded`. |
| [`experiment.js`](./src/services/experiment.js) | Validates experiment selections, schedules runs, catches each run's provider error for reporting, identifies missing expected claims, and aggregates overall, per-mode, per-variant, and repeated-value consistency results. |
| [`benchmarkTasks.js`](./src/services/benchmarkTasks.js) | Defines standard and large synthetic calculation tasks and computes their reference metrics independently of model output. |

### Other important files

| File or folder | Responsibility |
|---|---|
| [`scripts/createSampleWorkbook.js`](./scripts/createSampleWorkbook.js) | Converts the synthetic JSON fixture into the three-sheet Excel workbook. |
| [`scripts/createLargeSyntheticDataset.js`](./scripts/createLargeSyntheticDataset.js) | Reproducibly generates the 400-row synthetic dataset in JSON, CSV, and Excel formats using a fixed seed. |
| [`scripts/runExperiment.js`](./scripts/runExperiment.js) | Parses command-line options, loads the workbook and environment, calls the experiment service, saves a timestamped JSON report, and prints aggregate results. |
| [`src/services/benchmarkTasks.js`](./src/services/benchmarkTasks.js) | Defines the synthetic benchmark tasks and calculates reference metrics independently in JavaScript. |
| [`scripts/exportExperimentExample.js`](./scripts/exportExperimentExample.js) | Reconstructs each prompt and input from a saved report and exports a two-sheet Excel workbook, run-by-run Markdown walkthrough, and CSV. |
| [`data/sample-engagement.json`](./data/sample-engagement.json) | Human-readable synthetic source rows used to create the workbook. |
| [`data/sample-engagement.xlsx`](./data/sample-engagement.xlsx) | Workbook consumed by the server and experiment. Re-create it with `npm run sample:workbook`. |
| [`data/synthetic-engagement-400.json`](./data/synthetic-engagement-400.json), [CSV](./data/synthetic-engagement-400.csv), [Excel](./data/synthetic-engagement-400.xlsx) | Reproducible 400-row synthetic engagement dataset for the opt-in complex benchmark task. Recreate with `npm run data:large:generate`. |
| [`test/`](./test/) | Node.js built-in test-runner tests for the API, metrics, benchmark tasks, prompt strategies, LLM handling, and experiment behavior. |
| `docs/`, `examples/` | Local-only research documents and generated example exports; excluded from Git. |
| `reports/experiments/` | Local experiment reports; only the direct- and grounded-mode summary CSVs are tracked. |

### Workbook input format

The workbook must contain the following worksheets and columns:

| Worksheet | Required columns | Meaning |
|---|---|---|
| `Daily Engagement` | `date`, `app_opens`, `active_users` | One row per date for engagement data |
| `Push Notifications` | `date`, `notifications_sent`, `notifications_opened` | One row per same date for notification totals |

Dates must be valid; each count must be a non-negative integer; dates must be unique within a sheet; the sheets must contain matching date rows; and notifications opened cannot exceed notifications sent. The current metrics use app opens and notification counts; `active_users` is loaded but is not used in a metric yet.

## 11. Tests and troubleshooting

Run all tests with:

```bash
npm test
```

The tests use Node's built-in `node:test` runner and do not require a live API key. They cover metric calculations, prompt variants, claim validation, API response behavior, provider response handling, retries, and experiment reporting/options.

Common issues:

- **`Set ... API_KEY and ... MODEL`**: the server did not find the selected provider's key and model in its process environment or `.env`. The `.env.example` file is a template only.
- **Provider says model not found/available**: check the current model identifier enabled for your account and update the matching model variable in `.env`.
- **Workbook missing or invalid**: run `npm run sample:workbook`, or check `WORKBOOK_PATH`, required worksheet names, headers, dates, and matching date rows.
- **Port is invalid or unavailable**: `PORT` must be an integer from 1 to 65535; choose an unused port if 3000 is already occupied.
- **Experiment fails**: inspect the terminal error and the saved JSON report. Provider quotas/network failures can happen; retry count is bounded and later scheduled calls are still recorded.

## 12. Privacy, security, and limitations

- All checked-in workbook data is synthetic. Do not put employer, customer, or personal data in this repository.
- `grounded` mode sends calculated metric values to the selected LLM provider. `direct` mode sends the synthetic daily rows. Both involve sending data to an external provider.
- Check provider terms and receive the required authorization before sending any non-synthetic data to an external service.
- Keep `.env` private. Do not paste API keys into source code, issue reports, screenshots, or commits.
- The validator checks structured claims, not every number in free-form prose. A `MATCH` does not prove that the entire summary is correct or complete.
- The current experiments use a small synthetic dataset and one 400-row synthetic dataset; they do not establish general model reliability or causal explanations.
- Missing dates, data quality beyond the workbook checks, additional metrics, uncertainty, and prose-to-claim consistency need more work before this could be used for real analysis.

## 13. Current implementation and next steps

Implemented: synthetic workbook generation/loading, deterministic metric calculations, claim validation, Koa/Joi API, optional Gemini/DeepSeek summary generation, two-mode prompt comparison, repeated runs, JSON reports, and example CSV output.

Possible future work:

1. Add multiple synthetic datasets and edge cases, including missing dates and zero denominators.
2. Extract numeric values from prose independently, then compare them with structured claims.
3. Add more metric definitions and include explicit units and rounding rules.
4. Evaluate more providers/models and a larger, pre-defined set of test cases.
5. Improve report presentation while keeping all private/provider-generated output out of source control unless it has been reviewed.

The code uses CommonJS JavaScript, Koa route handlers, and Joi validation. It follows familiar backend patterns while using maintained dependencies; it does not copy company code.
