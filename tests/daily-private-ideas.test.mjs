import test from "node:test";
import assert from "node:assert/strict";
import { compactSeedSchema, expectedIdeaCount, validateIdea, validateIdeas } from "../scripts/generate-daily-private-ideas.mjs";
import { documentsFor, validateIdeas as validateCreatedIdeas } from "../scripts/create-daily-private-ideas.mjs";

const detail = (text) => `${text}. This is concrete enough for a coding agent to implement and verify without making an unstated product decision.`;
const list = (prefix) => [detail(`${prefix} first case`), detail(`${prefix} second case`)];

function validIdea(overrides = {}) {
  const name = overrides.application_name || "Local Evidence Ledger";
  const base = {
    schema_version: "2.0", application_name: name, repository_slug: "local-evidence-ledger",
    product_definition: detail("A private desktop application that captures, validates, and reviews recurring evidence records before producing an explainable recommendation"),
    problem: detail("People lose the evidence behind recurring decisions because notes and transactions are scattered across files and no deterministic review trail exists"),
    target_user: detail("A privacy-conscious individual who needs repeatable evidence-backed decisions without sharing personal records with a cloud service"),
    primary_use_cases: list("Record and review a decision"), non_goals: list("Do not provide social collaboration"),
    application_type: detail("Offline-first desktop application"), supported_platforms: ["macOS desktop"], selected_frameworks: ["Electron shell", "Next.js renderer", "SQLite persistence"],
    selected_runtime: detail("Node.js desktop runtime with a local SQLite database and an IPC boundary between renderer and main process"),
    architecture_overview: detail("Renderer writes user actions through typed IPC handlers into a local SQLite repository; a deterministic rules service computes evidence-backed status before optional model review"),
    domain_model: { entities: [
      { name: "EvidenceRecord", responsibility: detail("Stores one user-supplied piece of evidence"), stable_identifier: { name: "evidence_record_id", type: "UUID", required: true }, required_fields: [{ name: "body", type: "string", validation: detail("Trimmed text between one and ten thousand characters") }], optional_fields: [{ name: "source_url", type: "string", validation: detail("Optional HTTPS URL validated before storage") }], relationships: detail("Belongs to exactly one DecisionCase"), lifecycle: detail("Draft becomes verified or rejected after deterministic validation"), persistence_location: detail("SQLite evidence_records table"), example_valid: { evidence_record_id: "uuid", body: "Verified invoice total" }, example_invalid: { body: "" } },
      { name: "DecisionCase", responsibility: detail("Groups evidence and persists a final explainable decision"), stable_identifier: { name: "decision_case_id", type: "UUID", required: true }, required_fields: [{ name: "title", type: "string", validation: detail("Trimmed title with three to one hundred characters") }], optional_fields: [{ name: "note", type: "string", validation: detail("Optional note capped at ten thousand characters") }], relationships: detail("Has many EvidenceRecords and one computed DecisionResult"), lifecycle: detail("Open becomes assessed, then archived by explicit user action"), persistence_location: detail("SQLite decision_cases table"), example_valid: { decision_case_id: "uuid", title: "Monthly spend review" }, example_invalid: { title: "" } },
    ] },
    subsystem_contracts: [
      { name: "Evidence validation service", responsibility: detail("Normalizes and validates evidence before persistence"), selected_mechanism: detail("Zod schemas in the Electron main process with typed IPC request and response objects"), input_schema: { body: "string", source_url: "optional URL" }, output_schema: { record: "EvidenceRecord", issues: "ValidationFinding[]" }, persistence_effects: detail("Writes only a validated EvidenceRecord transaction"), failure_modes: detail("Malformed fields, duplicate identifiers, and unavailable database"), recovery_behaviour: detail("Returns typed validation issues and leaves prior records unchanged"), security_boundary: detail("Renderer cannot access files or database directly"), verification_method: detail("Unit fixtures cover valid, invalid, duplicate, and offline cases") },
      { name: "Decision rules service", responsibility: detail("Computes transparent decision status and supporting evidence"), selected_mechanism: detail("Pure TypeScript rules module with ordered rule definitions and SQLite read model"), input_schema: { case_id: "UUID", evidence: "EvidenceRecord[]" }, output_schema: { result: "DecisionResult", findings: "ValidationFinding[]" }, persistence_effects: detail("Persists an immutable computed result with source evidence identifiers"), failure_modes: detail("Missing required evidence or unsupported rule version"), recovery_behaviour: detail("Returns incomplete status with missing-evidence findings instead of a fabricated decision"), security_boundary: detail("Only local validated records enter the deterministic engine"), verification_method: detail("Golden fixtures assert deterministic calculations and explanations") },
    ],
    frontend_architecture: detail("Electron renderer uses React with a maintained accessible data grid, local Zustand view state, and route-level detail panes; no generic dashboard abstraction is used"),
    backend_architecture: detail("Electron main process owns SQLite, typed IPC, migration execution, and deterministic services; renderer only invokes allowlisted typed IPC handlers"),
    persistence: detail("SQLite stores normalized records, schema migrations, immutable results, and local audit timestamps with backups exported by explicit user action"),
    integrations: detail("No essential network integration exists in the MVP; CSV import and export remain local and require explicit file selection"),
    deterministic_logic: detail("Field validation, record deduplication, rule ordering, evidence completeness checks, arithmetic, and status thresholds run in pure TypeScript before any optional model assistance"),
    model_assisted_logic: { applicable: true, responsibilities: list("Identify ambiguous narrative wording after deterministic result"), data_sent: detail("Only user-selected redacted evidence snippets and deterministic findings are sent through the configured provider interface"), data_never_sent: detail("Raw local database, filesystem paths, credentials, and unselected evidence are never sent"), structured_output: { summary: "string", uncertainty: "low|medium|high", cited_evidence_ids: "UUID[]" }, validation_retry: detail("Validate output against schema once, retry with validation errors once, then show deterministic result alone"), uncertainty: detail("Display model uncertainty separately and never change deterministic status from it"), offline_value: detail("The full validation and decision workflow remains useful with no model available") },
    model_provider_contract: { provider_interface: detail("Configurable OpenAI-compatible structured-output provider selected by capability declaration rather than a versioned model identifier"), required_capabilities: list("JSON schema structured output and local availability probe"), availability_validation: detail("Probe provider health and requested capabilities before enabling model assistance"), fallback: detail("Keep deterministic result and show an optional explanation unavailable state"), data_boundary: detail("Only explicit redacted fields cross the adapter boundary"), secret_handling: detail("Secrets stay in OS credential storage and never reach renderer or logs"), rate_limit_retry: detail("Use capped exponential retry only for idempotent explanation requests"), cost_control: detail("Estimate token budget before request and require confirmation over the configured daily limit"), offline_degradation: detail("Render deterministic findings and evidence without a model explanation") },
    rules_and_constraints: { applicable: true, rule_schema: { id: "string", type: "required_evidence|minimum_count", target: "field", operator: "equals|greater_than_or_equal", expected_value: "number|string", severity: "critical|warning", weight: "number" }, supported_rule_types: ["required_evidence", "minimum_count"], inputs: detail("Validated EvidenceRecords and the active rule-set version"), outputs: detail("ValidationFindings with evidence IDs, severity, and deterministic explanation"), severity_levels: ["critical", "warning"], hard_fail_behaviour: detail("Critical failures produce incomplete status and block a final recommendation"), precedence: detail("Critical rules run before warnings; lower-priority warnings cannot override a hard failure"), partial_credit: detail("Warnings reduce completeness score but retain all supporting evidence"), explainability: detail("Every finding names the rule, input evidence, and reason"), examples: list("Rule example with expected result"), test_fixtures: list("Deterministic rule fixture") },
    scoring_and_decision_logic: { applicable: true, dimensions: ["evidence completeness", "rule compliance"], formula: detail("Completeness equals weighted satisfied rules divided by total applicable rule weight; any critical failure sets final status to incomplete"), normalization: detail("Weights normalize to one across applicable noncritical rules"), hard_failures: detail("Any critical required-evidence failure forces incomplete regardless of partial score"), partial_credit: detail("Warning rule failures contribute zero for their own weight while satisfied rules retain their weight"), thresholds: detail("Complete requires one hundred percent critical compliance and at least eighty percent noncritical completeness"), missing_data: detail("Missing evidence emits a finding and receives zero for the affected rule"), uncertainty: detail("Unknown fields remain unknown and cannot be inferred into a passing result"), deterministic_components: ["Rule matching", "Weight arithmetic"], model_components: ["Optional explanation only"], evidence: detail("Each score includes the exact finding and evidence record IDs used by the calculation"), sample_calculation: detail("Three of four noncritical weights satisfied yields 0.75 completeness; a critical failure still yields incomplete status"), test_cases: list("Scoring test case") },
    evaluation_rubric: { applicable: true, dimensions: [{ id: "evidence-completeness", name: "Evidence completeness", definition: detail("Measures whether required source records exist and validate"), evidence_source: detail("Validated EvidenceRecord identifiers attached to each rule"), scoring_range: "0 to 1", anchors: ["0 missing required evidence", "1 all required evidence present"], weight: 0.5, evaluation_mode: "deterministic", high_example: detail("All required evidence records pass validation"), low_example: detail("A required record is absent or invalid"), uncertainty: detail("Unknown values remain unscored and visible to the user") }] },
    state_transitions: list("DecisionCase open to assessed to archived with explicit user initiated transitions"), security_and_privacy: detail("Local-only persistence, typed IPC, input limits, least privilege, schema validation, and no automatic external writes protect user evidence"), permissions: detail("The app requests only explicit file chooser access for CSV import or export and no broad filesystem permission"), failure_and_recovery: detail("Transactions roll back on write errors, pending imports are resumable, invalid records stay quarantined, and exports never overwrite without confirmation"),
    smallest_experiment: { scope: detail("A command-line rule evaluator for two evidence types and one decision status"), minimal_domain_scope: detail("EvidenceRecord and DecisionCase with one required-evidence rule"), timebox: "Four hours", success_threshold: detail("Ten fixture cases return the expected deterministic status and explanation"), exclusions: ["No model assistance", "No CSV import"] },
    mvp: { scope: detail("Desktop record capture, local persistence, deterministic review, evidence detail, and local export"), selected_ui: detail("Accessible React data grid plus record detail form and evidence-linked result panel"), persistence: detail("SQLite with explicit migrations and local backup export"), essential_integrations: ["Local CSV import through explicit file chooser"], exclusions: ["Collaboration", "Cloud sync"] },
    implementation_phases: [
      { name: "Deterministic experiment", prerequisites: ["Approved local project root"], deliverables: ["Domain schemas", "CLI rule evaluator"], acceptance_criteria: ["Ten fixtures give expected status"], tests: ["Unit fixtures"], exclusions: ["Desktop shell"] },
      { name: "Usable local MVP", prerequisites: ["Experiment passes"], deliverables: ["Electron UI", "SQLite persistence"], acceptance_criteria: ["User can create, assess, and reopen a case"], tests: ["Integration IPC test", "End-to-end desktop flow"], exclusions: ["Model explanation"] },
      { name: "Optional explanation", prerequisites: ["MVP contract stable"], deliverables: ["Provider adapter", "Evidence-linked explanation"], acceptance_criteria: ["Model failure does not change deterministic result"], tests: ["Provider failure recovery fixture"], exclusions: ["Automatic cloud synchronization"] },
    ],
    performance_budgets: [
      { component: "Rule evaluation", input_assumption: detail("One hundred records and twenty rules"), state: "warm", device_assumption: detail("Apple Silicon laptop with local SQLite database"), target: "under 100 ms mandatory", measurement_method: detail("P95 measured in an automated fixture on the supported device class"), priority: "mandatory" },
      { component: "Optional explanation", input_assumption: detail("Ten redacted evidence snippets under eight thousand characters"), state: "warm", device_assumption: detail("Configured local or cloud provider availability"), target: "under ten seconds aspirational", measurement_method: detail("P95 provider adapter latency captured in integration test telemetry"), priority: "aspirational" },
    ],
    acceptance_criteria: Array.from({ length: 6 }, (_, index) => ({ id: `AC-${index + 1}`, component: "Evidence workflow", scenario: detail(`Fixture scenario ${index + 1} with valid and invalid evidence`), metric: "Expected deterministic status", threshold: "Matches fixture exactly", verification: detail("Automated test compares persisted result, evidence IDs, and user-visible explanation") })),
    test_strategy: { tests: ["unit", "integration", "end-to-end", "security", "recovery", "performance"].map((level) => ({ level, name: `${level} evidence fixture`, fixture: detail(`Representative ${level} fixture`), procedure: detail(`Execute the bounded ${level} procedure against local test data`), expected_result: detail(`The ${level} result matches the documented contract without external writes`) })) },
    risks: list("Risk with mitigation"), unresolved_questions: [{ question: detail("Whether CSV import should accept one additional optional evidence column after Phase 1"), blocks_phase_1: false, safe_default: detail("Ignore the optional column and preserve supported columns only"), decision_owner: "Kai" }],
    coding_agent_handoff: detail("Implement phases in order, preserve typed domain and subsystem contracts, request approval before dependencies or external writes, and never replace deterministic decisions with model prose"),
    quality_gate: { product_value: { score: 8, rationale: detail("The app turns recurring evidence review into a repeatable local workflow") }, distinctiveness: { score: 8, rationale: detail("It combines evidence-linked deterministic decisions with optional constrained explanation") }, repeat_usage: { score: 7, rationale: detail("Monthly or weekly decisions create a recurring review habit") }, feasibility: { score: 9, rationale: detail("Electron, SQLite, and pure TypeScript rules are small and local") }, portfolio_value: { score: 8, rationale: detail("It demonstrates local-first architecture, contracts, validation, and reliable AI boundaries") } },
    distinctiveness: { material_difference: detail("Unlike generic note apps, each conclusion carries deterministic rules and exact evidence links"), repository_overlap_check: detail("The owned-repository catalogue contains no local evidence-ledger app with deterministic review contracts") },
    repository_plan: { principal_files: ["src/domain/evidence.ts", "src/services/rules.ts", "src/main/ipc.ts", "src/renderer/case-page.tsx"], tree: ["src/domain", "src/services", "src/main", "src/renderer"] },
  };
  return { ...base, ...overrides };
}

test("manual and scheduled counts are constrained", () => {
  assert.equal(expectedIdeaCount("1"), 1);
  assert.equal(expectedIdeaCount("3"), 3);
  assert.throws(() => expectedIdeaCount("2"));
  assert.equal(compactSeedSchema(1).properties.ideas.maxItems, 1);
});

test("incomplete technical-sales-style specifications are rejected", () => {
  const idea = validIdea({ application_name: "Technical Sales Pitch Architect", repository_slug: "technical-sales-pitch-architect" });
  idea.domain_model.entities = [];
  assert.throws(() => validateIdea(idea, 0), /domain entities/);
});

test("vague mechanisms and missing scoring detail are rejected", () => {
  const idea = validIdea();
  idea.subsystem_contracts[0].selected_mechanism = "Generate a score";
  assert.throws(() => validateIdea(idea, 0), /vague mechanism/);
  idea.subsystem_contracts[0].selected_mechanism = detail("Zod schema validation in the Electron main process with typed IPC contracts");
  idea.scoring_and_decision_logic = { applicable: false, reason: detail("Not needed") };
  assert.throws(() => validateIdea(idea, 0), /decision outputs/);
});

for (const name of ["expense tracker", "document workflow", "learning trainer", "desktop utility", "CLI service"]) {
  test(`coding-ready ${name} fixture passes semantic validation`, () => {
    const idea = validIdea({ application_name: `${name} evidence ledger`, repository_slug: name.toLowerCase().replace(/ /g, "-") + "-ledger" });
    assert.equal(validateIdea(idea, 0).application_name, `${name} evidence ledger`);
  });
}

test("creator makes the complete coding package and enforces exact one review idea", () => {
  const idea = validIdea();
  assert.equal(validateIdeas({ ideas: [idea] }, 1).ideas.length, 1);
  assert.equal(validateCreatedIdeas({ ideas: [idea] }, 1).length, 1);
  const docs = documentsFor(idea, "2026-08-03");
  for (const path of ["README.md", "DOMAIN_MODEL.md", "INTERFACES.md", "RULES_AND_SCORING.md", "CODING_HANDOFF.md", "idea-specification.json"]) assert.ok(docs[path], `${path} is included`);
});
