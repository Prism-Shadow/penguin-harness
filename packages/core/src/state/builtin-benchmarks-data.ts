/**
 * The built-in Harbor Benchmarks as data: what each one is, and which upstream tasks it runs.
 *
 * Every case is a Harbor task directory in the benchmark repository (`task` names it), seeded
 * here as text only — see builtin-benchmarks.ts for how a row becomes a statement and a rubric.
 * Each list mirrors the candidates of that benchmark's `selection.json` in the repository, in its
 * order; the pilot's cut is deleting rows, and the case numbers (`CASE-001-…`) follow the
 * remaining rows' order. Once a release has seeded a Benchmark, a Project keeps the case list it
 * was given (project-benchmarks.ts never rewrites one). Summaries say what a task asks
 * and what it delivers, never how to solve it: they are public to every agent that reads the
 * Benchmark, an optimizer included.
 */
import type { BuiltinBenchmark } from "./builtin-benchmarks.js";

/** The public repository that holds the task folders, the Harbor adapter and the scripts. */
export const BENCHMARK_REPO = "https://github.com/Prism-Shadow/penguin-harness-benchmark";

/**
 * The revision of that repository every statement links and every evaluation fetches. What ships
 * is a 40-character commit id, the one that carries the measured results; until that commit
 * exists this is a branch, and the release guard in test/builtin-benchmarks.test.ts (expected to
 * fail until the pin) says so.
 */
export const BENCHMARK_REPO_REF = "main";

/** Harbor release the tasks and the adapter are checked against. */
export const HARBOR_VERSION = "0.23.0";

/** The adapter that runs PenguinHarness inside a task container (`agents/penguin_agent`). */
export const HARBOR_AGENT = "penguin_agent:PenguinAgent";

const IN_REPO =
  "A built-in Harbor benchmark: each task runs in Docker through the Harbor framework and is " +
  "scored by its own verifier, and the task files are in the public repository " +
  "Prism-Shadow/penguin-harness-benchmark. Each Project is given it once; a deleted one stays " +
  "deleted.";

export const BUILTIN_BENCHMARKS: BuiltinBenchmark[] = [
  {
    id: "terminal-bench",
    title: "Terminal-Bench 4.0 (CPU subset)",
    description:
      "Hard, realistic tasks done in a terminal, across software, security, science, machine " +
      `learning, operations, hardware and media, chosen to run on CPU-only Docker. ${IN_REPO}`,
    source: "Terminal-Bench 4.0 (Harbor Hub `terminal-bench/terminal-bench`, revision 4)",
    upstream: { url: "https://github.com/harbor-framework/terminal-bench", license: "Apache-2.0" },
    agentNetwork: "public",
    verifier: "separate container",
    downloads: "Docker Hub (the prebuilt task images)",
    runTimeout: "25m",
    maxTurns: 200,
    note: "The instruction keeps upstream's own time budget; the run stops the agent at `run_timeout`.",
    cases: [
      {
        task: "music-harmony",
        title: "Harmonize a chorale excerpt in four parts",
        summary:
          "Complete a four-voice (SATB) harmonization of the excerpt in a score PDF, in the style of a Bach chorale, and label every chord with a Roman numeral. The deliverable is a MusicXML file with the harmony annotations embedded.",
        category: "Media / Music",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 1,
      },
      {
        task: "html-js-filter",
        title: "Strip JavaScript from HTML without breaking it",
        summary:
          "Write a Python script that removes every way to run JavaScript from an HTML file in place, while keeping legitimate markup, formatting and harmless attributes intact. The deliverable is the script, run by the verifier on its own HTML samples.",
        category: "Security / AppSec",
        cpus: 2,
        memoryMb: 8192,
        expertHours: 0.75,
      },
      {
        task: "interleaved-vigenere",
        title: "Break an unnamed classical cipher",
        summary:
          "Build a command-line tool that reads a ciphertext produced by an unspecified classical cipher, with a fresh key on every run, and prints the recovered English plaintext. Identifying the cipher is part of the task; the verifier scores recovery on new ciphertexts within a time limit.",
        category: "Security / Cryptography",
        cpus: 4,
        memoryMb: 4096,
        expertHours: 2,
      },
      {
        task: "photonic-waveguide-routing",
        title: "Route photonic waveguides under physical constraints",
        summary:
          "Route nine waveguide nets across a board described by a layout specification, within its bend geometry, obstacle clearance and separation rules, and write the waypoint paths as JSON. The verifier checks the routes against the specification and its cost weights.",
        category: "Software / Algorithms",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 0.75,
      },
      {
        task: "bun-sourcemap-leak",
        title: "Stop a Bun release build from leaking private sources",
        summary:
          "Fix the release pipeline of a Bun/TypeScript app so its built artifacts and source maps expose only the sources a provenance policy marks public, while the built client and server keep their exact behaviour. The verifier rebuilds the release and inspects what it ships.",
        category: "Software / Systems",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 1.5,
      },
      {
        task: "mvcc-lsm-compaction",
        title: "Fix a visibility bug in an MVCC LSM storage engine",
        summary:
          "Diagnose a data-visibility failure from a crash report against a reduced C++ model of an MVCC LSM engine, fix it without giving up compaction, and add a deterministic regression test. The verifier builds and tests the fixed model.",
        category: "Software / Databases",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 4,
      },
      {
        task: "foodstuff-beta-activity",
        title: "Determine the beta activity of a foodstuff",
        summary:
          "From liquid-scintillation measurements and Sr-90 reference tables, derive the counting efficiency, the volumetric and gravimetric factors, the detection limit and the sample's activity concentration. The results go into a text file in a fixed format, which the verifier compares with the expected values.",
        category: "Science / Chemistry",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 1.5,
      },
      {
        task: "roy-polymorph-cn",
        title: "Relate ROY polymorph geometry to nitrile stretches",
        summary:
          "Fit a physically motivated model linking the conformation of twelve ROY polymorphs, given as crystal geometries, to their measured nitrile stretch frequencies, then answer six questions about extremes, predicted frequencies and a predicted colour. The answers go into one CSV file.",
        category: "Science / Chemistry",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 3,
      },
      {
        task: "sound-change-cascade",
        title: "Recover an ordered cascade of sound changes",
        summary:
          "From 780 pairs of proto-forms and their modern reflexes, reconstruct the ordered sound-change rules that turn every proto-form into its reflex, in the given rule engine's JSON format. The deliverables are the rule set and its ordering.",
        category: "Science / Linguistics",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 4,
      },
      {
        task: "protein-autointerp-disulfide",
        title: "Predict an unnamed residue-level protein feature",
        summary:
          "Eleven protein sequences come labelled with the positions of an unnamed residue-level feature. Work out what the feature is and predict its exact positions in held-out query sequences, written as JSON.",
        category: "Science / Biology",
        cpus: 4,
        memoryMb: 8192,
        expertHours: 2,
      },
      {
        task: "vllm-deepseek-streaming",
        title: "Fix corrupted streaming responses in vLLM",
        summary:
          "Clients of a vLLM server running a reasoning model intermittently get mis-segmented streams and tool-call JSON they cannot parse. Find and fix the bug in the vLLM source tree; the verifier exercises the streaming paths with its own tests.",
        category: "ML / Inference",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 2,
      },
      {
        task: "embedding-drift-monitor",
        title: "Repair an embedding drift monitor",
        summary:
          "An embedding drift monitor built on KS, PSI and MMD tests raises false alarms, misses real drift and flickers between states. Fix every production module, the statistical utilities as well as the alert debouncing; the verifier runs the monitor on its own scenarios.",
        category: "ML / Inference",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 5,
      },
      {
        task: "cargo-flight-dispatch",
        title: "Fix a cargo flight dispatch planner",
        summary:
          "A cargo airline's dispatch planner computes wrong fuel figures, clears overweight loads and ignores crosswind limits. Fix its navigation, aircraft-performance and dispatch modules against the given airport, aircraft, cargo and weather data; the verifier checks the plans they produce.",
        category: "Operations / Logistics",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 2.5,
      },
      {
        task: "production-planning",
        title: "Plan five days of production across ERP, MES and WMS",
        summary:
          "Through a documented database gateway, inspect a plant's systems and produce a valid five-day rolling production plan: a planning run with work orders, a dispatch queue and material reservations. The deliverables are SQL writeback files for the three systems.",
        category: "Operations / Supply chain",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 4,
      },
      {
        task: "freecad-platform-drawing",
        title: "Model a part in FreeCAD from an engineering drawing",
        summary:
          "Write a FreeCAD Python script that builds the part shown in an engineering drawing image as a single PartDesign body and saves it. The drawing is the only source of dimensions; the verifier measures the saved solid.",
        category: "Hardware / CAD",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 1.5,
      },
    ],
  },
  {
    id: "terminal-bench-science",
    title: "Terminal-Bench-Science 0.1 (CPU subset)",
    description:
      "Research-grade scientific computing across the life, mathematical, physical, engineering " +
      `and earth sciences, chosen to run on CPU-only Docker. ${IN_REPO}`,
    source:
      "Terminal-Bench-Science 0.1 (Harbor Hub `terminal-bench-science/terminal-bench-science`, revision 10)",
    upstream: {
      url: "https://github.com/harbor-framework/terminal-bench-science",
      license: "Apache-2.0",
    },
    agentNetwork: "public",
    verifier: "separate container",
    downloads: "Docker Hub and the package mirrors the task images build from",
    runTimeout: "25m",
    maxTurns: 200,
    note: "Each task image builds from its Dockerfile on first use, typically in 5 to 20 minutes; later runs reuse it.",
    cases: [
      {
        task: "symbolic-regression",
        title: "Recover a hidden sparse rule behind a binary label",
        summary:
          "Training data holds 300 rows of 100 numeric predictors and a binary label produced by a sparse non-linear rule plus a little noise. Edit the provided regressor so it generalises to a held-out test set.",
        category: "Mathematical sciences / Statistics",
        cpus: 1,
        memoryMb: 2048,
        expertHours: 2,
      },
      {
        task: "variable-star-vetting",
        title: "Classify variable stars and measure their periods",
        summary:
          "Classify 100 stellar light curves into ten variable-star classes and report each star's main physical period. The answers go into one CSV file.",
        category: "Physical sciences / Astronomy",
        cpus: 2,
        memoryMb: 2048,
        expertHours: 3,
      },
      {
        task: "geometric-pharmacophore-alignment",
        title: "Pose six ligands into pharmacophore volumes",
        summary:
          "Generate a pose for each of six ligands so that its features fall inside the target's pharmacophore interaction volumes and no atom enters an excluded volume; one ligand is a macrocycle. The poses go into one SDF file.",
        category: "Physical sciences / Chemistry",
        cpus: 4,
        memoryMb: 2048,
        expertHours: 8,
      },
      {
        task: "dapi-he-alignment",
        title: "Match single cells between DAPI and H&E images",
        summary:
          "Register DAPI fluorescence images to deformed H&E histology images for three breast-cancer tissue patches, and match the single cells between the two modalities. The matches go into one CSV file per patch.",
        category: "Life sciences / Medicine",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 4,
      },
      {
        task: "clinical-metadata-recovery",
        title: "Recover blinded clinical annotations from transcriptomics",
        summary:
          "Six anonymised intestinal-biopsy transcriptomics cohorts from public IBD studies have clinical annotations withheld for blinded samples. Recover the annotations from the molecular signal and write them to one TSV file.",
        category: "Life sciences / Medicine",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 4,
      },
      {
        task: "genomic-model-ranking",
        title: "Rank genomic models by transfer and predict target labels",
        summary:
          "Rank the supplied genomic prediction models by how well they transfer to target sequence families and cell contexts, and estimate a label probability for every unlabelled target example. The deliverables are the ranking, the predictions and the script that makes them.",
        category: "Life sciences / Biology",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 5,
      },
      {
        task: "diag-chipseq",
        title: "Normalize ChIP-seq signal against an external reference",
        summary:
          "For four blinded H3K9ac ChIP-seq comparisons, decide which external-reference measurements support quantitative scaling, and recover the externally corrected global and peak-level changes between perturbed and control samples. The results go into three TSV tables.",
        category: "Life sciences / Biology",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 5,
      },
      {
        task: "mri-harmonization",
        title: "Harmonize MRI features across scanners",
        summary:
          "From subjects scanned on several MRI scanners, build a model that removes scanner effects from 221 multimodal imaging-derived phenotypes while keeping each subject's biological signal. The model is one JSON file.",
        category: "Life sciences / Neuroscience",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 4,
      },
      {
        task: "baseline-free-localization",
        title: "Localize damage from a single guided-wave inspection",
        summary:
          "Implement a method that localizes damage in a plate from one guided-wave inspection, with neither a pristine reference measurement nor labelled examples. The deliverable is a Python solution file.",
        category: "Engineering sciences / Mechanical engineering",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 4,
      },
      {
        task: "sparse-network-assimilation",
        title: "Assimilate data from a sparse, asynchronous sensor network",
        summary:
          "Recover the per-site forcing, the full state and every sensor's clock offset of a chaotic Lorenz-96 ring from a short record of a sparse network of uncalibrated, asynchronous sensors. The estimates go into one NPZ file.",
        category: "Earth sciences / Atmospheric sciences",
        cpus: 2,
        memoryMb: 4096,
        expertHours: 18,
      },
    ],
  },
  {
    id: "deep-swe",
    title: "DeepSWE v1.1 (subset)",
    description:
      "Long-horizon features and fixes in real Go, Python, TypeScript, JavaScript and Rust " +
      "repositories, graded by hidden tests on the committed change; the agent works offline " +
      `except for its model provider. ${IN_REPO}`,
    source: "DeepSWE v1.1 (Harbor Hub `datacurve/deep-swe-1-1`, revision 1)",
    upstream: { url: "https://github.com/datacurve-ai/deep-swe", license: "Apache-2.0" },
    agentNetwork: "no-network",
    verifier: "separate container, hidden tests on the committed diff",
    downloads: "public.ecr.aws (the prebuilt task images, several GB each)",
    runTimeout: "30m",
    maxTurns: 250,
    note: "Only what the agent commits is graded.",
    cases: [
      {
        task: "prometheus-typed-label-sorting",
        title: "Fix PromQL label sorting across typed and untyped values",
        summary:
          "PromQL's label sorting must order mixed typed and untyped label values by stable typed comparison rules. Make the fix in the Prometheus repository and commit it.",
        category: "Go / bugfix",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "tengo-callable-instance-isolation",
        title: "Fix Go-side calls of Tengo callables and closures",
        summary:
          "Let Go code invoke exported Tengo functions and closures while keeping their runtime context and isolating the state of each compiled instance. Make the fix in the Tengo repository and commit it.",
        category: "Go / bugfix",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "expr-try-catch-errors",
        title: "Add try/catch error recovery to expr",
        summary:
          "Add expression- and block-level error recovery to the expr language: try, catch, finally, throw, retry and errtype. Implement it in the expr repository and commit it.",
        category: "Go / feature request",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "dateutil-rfc5545-timezone-interop",
        title: "Add RFC 5545 timezone interoperability to dateutil",
        summary:
          "Extend dateutil's rrule and rruleset so timezone-aware recurrence data can be serialized, parsed and compared as RFC 5545 specifies. Implement it in the dateutil repository and commit it.",
        category: "Python / enhancement",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "fastapi-implicit-head-options",
        title: "Add implicit HEAD and automatic OPTIONS responses to FastAPI",
        summary:
          "Add configurable implicit HEAD handling and automatic OPTIONS responses for FastAPI routes, routers and included routers. Implement it in the FastAPI repository and commit it.",
        category: "Python / feature request",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "httpx-streaming-json-iteration",
        title: "Add streaming JSON iteration to HTTPX responses",
        summary:
          "Add response iterators that parse JSON values incrementally from supported streaming media types. Implement them in the HTTPX repository and commit them.",
        category: "Python / feature request",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "tomlkit-toml-table-converters",
        title: "Add bidirectional table converters to tomlkit",
        summary:
          "Add in-place conversions between standard tables, inline tables, dotted keys and super tables that keep comments and round-trip integrity. Implement them in the tomlkit repository and commit them.",
        category: "Python / feature request",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "happy-dom-abort-pending-body-reads",
        title: "Abort pending body reads on shutdown in happy-dom",
        summary:
          "Interrupted request and response body reads, formData parsing and discarded timers must abort cleanly when happy-dom shuts down. Make the fix in the happy-dom repository and commit it.",
        category: "TypeScript / bugfix",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "ts-pattern-match-each",
        title: "Add matchEach to ts-pattern",
        summary:
          "Add a matcher to ts-pattern that evaluates every matching clause and returns all their results in order. Implement it in the ts-pattern repository and commit it.",
        category: "TypeScript / feature request",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "superjson-error-stack-serialization",
        title: "Add error stack serialization to SuperJSON",
        summary:
          "Add configurable serialization and restoration of error stacks, stack frames and causes to SuperJSON, with sanitization. Implement it in the SuperJSON repository and commit it.",
        category: "TypeScript / feature request",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "fd-deterministic-multi-key-sorting",
        title: "Add deterministic multi-key sorting to fd",
        summary:
          "Add repeatable multi-key sorting of fd's output, with deterministic tie-breaking and a seeded random order. Implement it in the fd repository and commit it.",
        category: "Rust / feature request",
        cpus: 2,
        memoryMb: 8192,
      },
      {
        task: "katex-multicolumn-array-spans",
        title: "Add multicolumn spans to KaTeX array environments",
        summary:
          "Parse and render `\\multicolumn` in KaTeX's array-like environments, with span-aware alignment and errors. Implement it in the KaTeX repository and commit it.",
        category: "JavaScript / feature request",
        cpus: 2,
        memoryMb: 8192,
      },
    ],
  },
  {
    id: "automation-bench",
    title: "AutomationBench (subset)",
    description:
      "Business workflows across simulated SaaS apps (CRM, email, spreadsheets, chat and help " +
      "desks) in sales, marketing, operations, support, finance and HR, each passed only when " +
      `every end-state check on the apps holds. ${IN_REPO}`,
    source: "AutomationBench 1.0.6 (converted to Harbor tasks)",
    upstream: { url: "https://github.com/zapier/AutomationBench", license: "MIT" },
    agentNetwork: "public",
    verifier: "same container, after the agent",
    downloads: "Docker Hub and PyPI (the task image builds in under a minute)",
    runTimeout: "10m",
    maxTurns: 50,
    note: "The agent acts on the simulated apps through the `ab` command the instruction describes.",
    cases: [
      {
        task: "sales-501-multi-hop-lookup",
        title: "Close a deal and route the win notice",
        summary:
          "Close a deal in the CRM and send the win notice to the recipients a routing policy prescribes, which depend on facts spread over several apps (Gmail, Google Drive, Google Sheets, Salesforce). The task passes only when all 6 end-state assertions hold.",
        category: "Sales / Multi-hop lookup",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "sales-504-recency-selection",
        title: "Apply the right phone update to a contact",
        summary:
          "Several emails propose phone-number changes for a contact who has look-alike namesakes; update the right CRM record and cite the sources in a note (Gmail, Salesforce). The task passes only when all 10 end-state assertions hold.",
        category: "Sales / Recency",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "marketing-1040-budget-reallocation",
        title: "Propose a marketing budget reallocation",
        summary:
          "Turn a channel-ROI sheet into a budget proposal for finance, following the current quarter's thresholds and the strategic context in the mailbox (Gmail, Google Drive, Google Sheets). The task passes only when all 24 end-state assertions hold.",
        category: "Marketing / Calculation with context",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "marketing-1008-contact-data-cleanup",
        title: "Audit and tag CRM contacts",
        summary:
          "Audit the CRM's contacts for malformed and duplicate records under the applicable data policy, tag the clean records and report the result, respecting the exemptions the policy names (HubSpot, Gmail, Slack). The task passes only when all 15 end-state assertions hold.",
        category: "Marketing / Data cleanup",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "operations-1323-access-request-validation",
        title: "Approve or deny access requests by policy",
        summary:
          "Decide the pending access requests against a seniority policy table, skip the ones already processed, and route approvals and denials to their channels (Google Sheets, Asana, Gmail). The task passes only when all 12 end-state assertions hold.",
        category: "Operations / Negative selection",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "operations-1339-contractor-badge-expiration",
        title: "Warn contractors whose badges expire soon",
        summary:
          "Find the contractor badges that expire within two weeks, apply the exclusions the records call for, and notify each remaining holder by SMS, email and chat (Google Sheets, Twilio, Gmail, Slack). The task passes only when all 18 end-state assertions hold.",
        category: "Operations / Date window with exclusions",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "support-1425-gorgias-refund-processing",
        title: "Process a batch of refund tickets",
        summary:
          "Work through 16 refund tickets according to a refund-policy sheet, producing the drafts, escalations, log rows, ticket replies and summary the policy asks for (Gorgias, Google Sheets, Gmail, Jira, Slack). The task passes only when all 63 end-state assertions hold.",
        category: "Support / Multi-app chain",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "support-1511-helpscout-customer-merge",
        title: "Decide which customer records to merge",
        summary:
          "Decide which of six look-alike customer pairs are the same person, leave merge notes on the matching help-desk conversations and post a summary (Google Sheets, Help Scout, Slack). The task passes only when all 30 end-state assertions hold.",
        category: "Support / Fuzzy matching",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "finance-4001-invoice-email-extract",
        title: "Log emailed invoices in a tracker",
        summary:
          "Extract invoices from emails into a tracking sheet, applying the corrections and policies found in the mailbox and chat, and report the logged total (Gmail, Google Sheets, Slack). The task passes only when all 9 end-state assertions hold.",
        category: "Finance / Unstructured extraction",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "hr-5032-employee-directory-update",
        title: "Update the employee directory",
        summary:
          "Apply a new hire, a termination and a title change to the employee directory sheet in place, then post a summary (Google Sheets, Slack). The task passes only when all 8 end-state assertions hold.",
        category: "HR / Record maintenance",
        cpus: 1,
        memoryMb: 2048,
      },
      {
        task: "hr-5018-candidate-rejection-followup",
        title: "Send candidate rejection follow-ups",
        summary:
          "Send each candidate the follow-up the recruiting sheet's notes call for, within the company's contact policy (Google Sheets, Gmail). The task passes only when all 8 end-state assertions hold.",
        category: "HR / Conflicting instructions",
        cpus: 1,
        memoryMb: 2048,
      },
    ],
  },
  {
    id: "rag-bench-essential",
    title: "Data Analysis Bench (rag-bench-essential, subset)",
    description:
      "Data analysis over long PDFs, scanned forms, hierarchical tables, spreadsheets and " +
      "document libraries, scored pass or fail by each case's own scorer; the tasks are " +
      `generated from the pinned upstream commit on the evaluating machine. ${IN_REPO}`,
    source: "rag-bench-essential, Data Analysis Bench (converted to Harbor tasks)",
    upstream: {
      url: "https://github.com/Prism-Shadow/rag-bench-essential",
      license: "MIT; the case data keeps the terms of the benchmark it comes from",
    },
    agentNetwork: "public",
    verifier: "same container, after the agent",
    downloads: "GitHub (the case data), Docker Hub and the Debian and PyPI mirrors",
    runTimeout: "15m",
    maxTurns: 100,
    generated: {
      command: "tools/rag_bench/fetch.sh && python3 tools/rag_bench/convert.py",
      casesUrl:
        "https://github.com/Prism-Shadow/rag-bench-essential/tree/979adae32d59c1b9a8a9d4ebd761c11c9d0f6e29/cases",
    },
    cases: [
      {
        task: "dabstep_real_fees_1681",
        title: "Find the fee rules that apply to a merchant on one day",
        summary:
          "Determine which fee rules apply to one merchant on one day from a 138k-row payments file, about a thousand fee rules and a domain manual. The answer is a set of fee IDs.",
        category: "Payments analytics / DABstep",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "docfinqa_oilgas_canada_pdf_hard",
        title: "Answer a financial question from an annual-report PDF",
        summary:
          "Answer a DocFinQA question from the original annual-report PDF rather than pre-extracted text, which takes finding the relevant production table and computing a percentage.",
        category: "Long PDF financial QA / DocFinQA",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "docvqa_contract_effective_date_ocr_hard",
        title: "Read a date from a scanned contract form",
        summary:
          "Answer a DocVQA question about a scanned form with handwritten fields; finding the right date field takes OCR and a careful reading of the page.",
        category: "Scanned document OCR / DocVQA",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "multihiertt_global_products_atoi_share_hard",
        title: "Compute a segment-share change from a report library",
        summary:
          "Answer a MultiHiertt question over a whole library of reports: find the one report with the relevant segment tables, then compute the change in a segment's share.",
        category: "Hierarchical tables / MultiHiertt",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "workspacebench_taobao_permissions_hard",
        title: "Derive a role-by-module permission matrix",
        summary:
          "From spreadsheets, slides, JSON and text files written in Chinese, infer a role-by-module permission matrix and deliver it as a CSV file, a Markdown specification and a JSON rule file.",
        category: "Workspace deliverables / Workspace-Bench",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "finlongdocqa_interest_expense_sensitivity_screen_hard",
        title: "Screen 10-K reports for interest-expense sensitivity",
        summary:
          "Screen real 10-K reports for interest-expense sensitivity disclosures, put them on a common basis, rank the eligible companies and justify every exclusion.",
        category: "Long-document screening / FinLongDocQA",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "prepbench_loyalty_tier_normalization_hard",
        title: "Normalize loyalty tiers and compute a profit share",
        summary:
          "Clean inconsistent loyalty tiers across transaction and customer tables, treat missing discounts as the task specifies, and compute one tier's share of profit.",
        category: "Data preparation / PrepBench",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "spreadsheetbench_working_paper_transpose_hard",
        title: "Transpose working-paper blocks between workbooks",
        summary:
          "Find the repeated working-paper blocks in three variant workbooks and transpose them into a destination sheet, which is compared cell by cell.",
        category: "Spreadsheet manipulation / SpreadsheetBench",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "harveylab_reps_diligence_discrepancy_hard",
        title: "Write a due-diligence discrepancy memo",
        summary:
          "Compare a draft purchase agreement's representations and disclosure schedules with the diligence materials (Word, Excel and email files), and deliver a Word memo naming each discrepancy.",
        category: "Legal due diligence / Harvey LAB",
        cpus: 1,
        memoryMb: 4096,
      },
      {
        task: "fdabench_app_sentiment_xsource_hard_v2",
        title: "Compute an app-review metric from two sources",
        summary:
          "Compute an app-review sentiment metric that needs both a review corpus and the method notes beside it; neither source alone defines the answer.",
        category: "Cross-source analytics / FDABench",
        cpus: 1,
        memoryMb: 4096,
      },
    ],
  },
];
