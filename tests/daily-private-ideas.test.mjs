import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeStructuralIds, compactSeedSchema, expectedIdeaCount, providerRequest, providerSchema, selectSeeds, validateIdea, validateIdeas } from "../scripts/generate-daily-private-ideas.mjs";
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
      { name: "EvidenceRecord", responsibility: detail("Stores one user-supplied piece of evidence"), stable_identifier: { name: "evidence_record_id", type: "UUID", required: true }, required_fields: [{ name: "body", type: "string", validation: detail("Trimmed text between one and ten thousand characters") }], optional_fields: [{ name: "source_url", type: "string", validation: detail("Optional HTTPS URL validated before storage") }], relationships: list("Belongs to exactly one DecisionCase"), lifecycle: detail("Draft becomes verified or rejected after deterministic validation"), persistence_location: detail("SQLite evidence_records table"), example_valid: { evidence_record_id: "uuid", body: "Verified invoice total" }, example_invalid: { body: "" } },
      { name: "DecisionCase", responsibility: detail("Groups evidence and persists a final explainable decision"), stable_identifier: { name: "decision_case_id", type: "UUID", required: true }, required_fields: [{ name: "title", type: "string", validation: detail("Trimmed title with three to one hundred characters") }], optional_fields: [{ name: "note", type: "string", validation: detail("Optional note capped at ten thousand characters") }], relationships: list("Has many EvidenceRecords and one computed DecisionResult"), lifecycle: detail("Open becomes assessed, then archived by explicit user action"), persistence_location: detail("SQLite decision_cases table"), example_valid: { decision_case_id: "uuid", title: "Monthly spend review" }, example_invalid: { title: "" } },
    ] },
    subsystem_contracts: [
      { name: "Evidence validation service", responsibility: detail("Normalizes and validates evidence before persistence"), selected_mechanism: detail("Zod schemas in the Electron main process with typed IPC request and response objects"), input_schema: { body: "string", source_url: "optional URL" }, output_schema: { record: "EvidenceRecord", issues: "ValidationFinding[]" }, persistence_effects: detail("Writes only a validated EvidenceRecord transaction"), failure_modes: list("Malformed fields, duplicate identifiers, and unavailable database"), recovery_behaviour: detail("Returns typed validation issues and leaves prior records unchanged"), security_boundary: detail("Renderer cannot access files or database directly"), verification_method: detail("Unit fixtures cover valid, invalid, duplicate, and offline cases") },
      { name: "Decision rules service", responsibility: detail("Computes transparent decision status and supporting evidence"), selected_mechanism: detail("Pure TypeScript rules module with ordered rule definitions and SQLite read model"), input_schema: { case_id: "UUID", evidence: "EvidenceRecord[]" }, output_schema: { result: "DecisionResult", findings: "ValidationFinding[]" }, persistence_effects: detail("Persists an immutable computed result with source evidence identifiers"), failure_modes: list("Missing required evidence or unsupported rule version"), recovery_behaviour: detail("Returns incomplete status with missing-evidence findings instead of a fabricated decision"), security_boundary: detail("Only local validated records enter the deterministic engine"), verification_method: detail("Golden fixtures assert deterministic calculations and explanations") },
    ],
    frontend_architecture: { selected_mechanism: detail("Electron renderer uses React with a maintained accessible data grid and route-level detail panes"), rationale: detail("React permits typed local forms and accessible evidence detail without a generic dashboard abstraction"), core_interactions: list("Create a case, attach evidence, and inspect deterministic findings"), state_representation: detail("Local Zustand state mirrors typed IPC snapshots and does not own durable evidence"), accessibility: detail("Keyboard navigable forms, labelled controls, focus restoration, and semantic result regions"), persistence: detail("Renderer requests persisted state only through typed IPC reads and writes"), testing: detail("Component tests cover forms and integration tests cover renderer to IPC workflows"), fallback: detail("When IPC is unavailable, render a recoverable local connection state without fabricating results") },
    backend_architecture: detail("Electron main process owns SQLite, typed IPC, migration execution, and deterministic services; renderer only invokes allowlisted typed IPC handlers"),
    persistence: detail("SQLite stores normalized records, schema migrations, immutable results, and local audit timestamps with backups exported by explicit user action"),
    integrations: detail("No essential network integration exists in the MVP; CSV import and export remain local and require explicit file selection"),
    deterministic_logic: detail("Field validation, record deduplication, rule ordering, evidence completeness checks, arithmetic, and status thresholds run in pure TypeScript before any optional model assistance"),
    model_assisted_logic: { applicable: true, responsibilities: list("Identify ambiguous narrative wording after deterministic result"), data_sent: detail("Only user-selected redacted evidence snippets and deterministic findings are sent through the configured provider interface"), data_never_sent: detail("Raw local database, filesystem paths, credentials, and unselected evidence are never sent"), structured_output: { summary: "string", uncertainty: "low|medium|high", cited_evidence_ids: "UUID[]" }, validation_retry: detail("Validate output against schema once, retry with validation errors once, then show deterministic result alone"), uncertainty: detail("Display model uncertainty separately and never change deterministic status from it"), offline_value: detail("The full validation and decision workflow remains useful with no model available") },
    model_provider_contract: { applicable: true, provider_interface: detail("Configurable OpenAI-compatible structured-output provider selected by capability declaration rather than a versioned model identifier"), required_capabilities: list("JSON schema structured output and local availability probe"), availability_validation: detail("Probe provider health and requested capabilities before enabling model assistance"), fallback: detail("Keep deterministic result and show an optional explanation unavailable state"), data_boundary: detail("Only explicit redacted fields cross the adapter boundary"), secret_handling: detail("Secrets stay in OS credential storage and never reach renderer or logs"), rate_limit_retry: detail("Use capped exponential retry only for idempotent explanation requests"), cost_control: detail("Estimate token budget before request and require confirmation over the configured daily limit"), offline_degradation: detail("Render deterministic findings and evidence without a model explanation") },
    rules_and_constraints: { applicable: true, owning_subsystem: "Decision rules service", rule_schema: { id: "string", type: "required_evidence|minimum_count", target: "field", operator: "equals|greater_than_or_equal", expected_value: "number|string", severity: "critical|warning", weight: "number" }, supported_rule_types: ["required_evidence", "minimum_count"], inputs: detail("Validated EvidenceRecords and the active rule-set version"), outputs: detail("ValidationFindings with evidence IDs, severity, and deterministic explanation"), severity_levels: ["critical", "warning"], hard_fail_behaviour: detail("Critical failures produce incomplete status and block a final recommendation"), precedence: detail("Critical rules run before warnings; lower-priority warnings cannot override a hard failure"), partial_credit: detail("Warnings reduce completeness score but retain all supporting evidence"), explainability: detail("Every finding names the rule, input evidence, and reason"), examples: list("Rule example with expected result"), test_fixtures: list("Deterministic rule fixture") },
    scoring_and_decision_logic: { applicable: true, dimensions: [{ id: "evidence-completeness", name: "Evidence completeness", weight: 0.5, definition: detail("Measures the share of required evidence records that survive deterministic validation") }, { id: "rule-compliance", name: "Rule compliance", weight: 0.5, definition: detail("Measures the share of applicable noncritical rules that are satisfied by validated evidence") }], formula: detail("Completeness equals weighted satisfied rules divided by total applicable rule weight; any critical failure sets final status to incomplete"), normalization: detail("Weights normalize to one across applicable noncritical rules"), hard_failures: detail("Any critical required-evidence failure forces incomplete regardless of partial score"), partial_credit: detail("Warning rule failures contribute zero for their own weight while satisfied rules retain their weight"), thresholds: detail("Complete requires one hundred percent critical compliance and at least eighty percent noncritical completeness"), missing_data: detail("Missing evidence emits a finding and receives zero for the affected rule"), uncertainty: detail("Unknown fields remain unknown and cannot be inferred into a passing result"), deterministic_components: ["Rule matching", "Weight arithmetic"], model_components: ["Optional explanation only"], evidence: detail("Each score includes the exact finding and evidence record IDs used by the calculation"), sample_calculation: detail("Three of four noncritical weights satisfied yields 0.75 completeness; a critical failure still yields incomplete status"), test_cases: list("Scoring test case") },
    evaluation_rubric: { applicable: true, dimensions: [{ id: "evidence-completeness", name: "Evidence completeness", definition: detail("Measures whether required source records exist and validate"), evidence_source: detail("Validated EvidenceRecord identifiers attached to each rule"), scoring_range: "0 to 1", anchors: ["0 missing required evidence", "1 all required evidence present"], weight: 1, evaluation_mode: "deterministic", high_example: detail("All required evidence records pass validation"), low_example: detail("A required record is absent or invalid"), uncertainty: detail("Unknown values remain unscored and visible to the user") }] },
    state_transitions: list("DecisionCase open to assessed to archived with explicit user initiated transitions"), security_and_privacy: list("Local-only persistence, typed IPC, input limits, least privilege, schema validation, and no automatic external writes protect user evidence"), permissions: list("The app requests only explicit file chooser access for CSV import or export and no broad filesystem permission"), failure_and_recovery: list("Transactions roll back on write errors, pending imports are resumable, invalid records stay quarantined, and exports never overwrite without confirmation"),
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
    acceptance_criteria: ["valid evidence creates an assessed case", "invalid evidence returns a typed issue", "critical rule blocks final decision", "CSV import preserves a valid row", "offline model fallback keeps deterministic result", "export requires explicit destination"].map((scenario, index) => ({ id: `AC-${index + 1}`, component: `Evidence workflow component ${index + 1}`, scenario: detail(scenario), metric: `Fixture-specific observable ${index + 1}`, threshold: `Expected contract result ${index + 1}`, verification: detail(`Automated verification ${index + 1} compares typed output, persisted evidence, and visible recovery state`) })),
    test_strategy: { tests: ["unit", "integration", "end-to-end", "security", "recovery", "performance"].map((level, index) => ({ level, name: `${level} evidence contract ${index + 1}`, fixture: detail(`Representative ${level} fixture ${index + 1} with a distinct failure mode`), procedure: detail(`Execute the bounded ${level} procedure ${index + 1} against local test data and inspect the documented signal`), expected_result: detail(`The ${level} result ${index + 1} matches the documented contract without external writes`) })) },
    risks: list("Risk with mitigation"), unresolved_questions: [{ question: detail("Whether CSV import should accept one additional optional evidence column after Phase 1"), blocks_phase_1: false, safe_default: detail("Ignore the optional column and preserve supported columns only"), decision_owner: "Kai" }],
    coding_agent_handoff: { objective: detail("Create the evidence-ledger MVP using the selected local desktop architecture"), mvp_scope: detail("Capture evidence, compute deterministic status, persist local records, and export only by explicit user action"), non_goals: list("No collaboration or cloud synchronization"), selected_frameworks: ["Electron shell", "Next.js renderer", "SQLite persistence"], selected_runtime: detail("Node.js desktop runtime with typed IPC and local SQLite"), supported_platforms: ["macOS desktop"], directory_structure: ["src/domain", "src/services", "src/main", "src/renderer"], expected_initial_files: ["src/domain/evidence.ts", "src/services/rules.ts", "src/main/ipc.ts", "src/renderer/case-page.tsx"], dependencies: ["electron", "next", "sqlite", "zod"], dependency_policy: detail("Ask for explicit approval before installing any package and pin compatible versions in the lockfile"), domain_schema_references: ["domain_model.entities.EvidenceRecord", "domain_model.entities.DecisionCase"], subsystem_contract_references: ["Evidence validation service", "Decision rules service"], rule_and_scoring_references: ["rules_and_constraints.rule_schema", "scoring_and_decision_logic.formula"], security_boundaries: list("Use typed IPC and local-only persistence"), permissions: list("Use only explicit file chooser access for import or export"), implementation_order: list("Implement domain schemas before deterministic services and UI"), phase_mapping: ["Deterministic experiment", "Usable local MVP", "Optional explanation"], acceptance_criterion_ids: ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-6"], verification_commands: ["npm test", "npm run lint", "npm run build"], seed_data_or_fixtures: list("Evidence record fixtures cover valid, invalid, and missing-rule cases"), migration_requirements: list("Create SQLite migrations from an empty local database only"), unresolved_non_blocking_decisions: list("Ignore optional CSV column using documented safe default"), stop_conditions: list("Stop if domain contracts conflict or a new cloud dependency becomes necessary") },
    quality_gate: { ...Object.fromEntries([["product_value", 8], ["distinctiveness", 8], ["repeat_usage", 7], ["feasibility", 9], ["portfolio_value", 8]].map(([key, score]) => [key, { score, rationale: detail(`${key} is supported by the evidence-ledger MVP, its specific local workflow, and a distinct implementation boundary`), evidence: list(`${key} evidence tied to evidence records and explicit user review`) }])), overall_score: 8, passing_threshold: 7, decision: "pass", rejection_reasons: [] },
    distinctiveness: { existing_alternatives: list("Generic note applications and cloud decision trackers"), alternative_categories: ["Note taking", "Decision support"], material_differences: { target_user: detail("A privacy-conscious individual making recurring evidence-backed decisions"), core_workflow: detail("Validate concrete evidence before producing one explainable deterministic decision"), domain_model: detail("EvidenceRecord and DecisionCase preserve source-linked deterministic state"), value_proposition: detail("Every recommendation remains tied to validated local evidence instead of generated prose"), architecture_or_behaviour: detail("Typed IPC, SQLite, and deterministic rules keep the core useful offline") }, repository_overlap_analysis: detail("The owned repository catalogue has no evidence-ledger app that combines typed local evidence, deterministic rules, and optional constrained explanation"), overlap_candidates_inspected: ["kai-studio", "generic note tool"], duplicate_risk: "low", uniqueness_verdict: "distinct", evidence: list("Repository catalogue comparison and MVP contract demonstrate a materially different workflow"), confidence_or_uncertainty: detail("High confidence after comparing target user, domain model, and core workflow; revisit only if a directly matching ledger is added") },
    repository_plan: { repository_name: "local-evidence-ledger", visibility: "private", intended_files: ["README.md", "PRODUCT.md", "ARCHITECTURE.md", "DOMAIN_MODEL.md", "INTERFACES.md", "RULES_AND_SCORING.md", "AI_BOUNDARIES.md", "SECURITY.md", "IMPLEMENTATION_PLAN.md", "ACCEPTANCE_CRITERIA.md", "PERFORMANCE_BUDGETS.md", "TEST_STRATEGY.md", "RISK_REGISTER.md", "UNRESOLVED_QUESTIONS.md", "CODING_HANDOFF.md", "idea-specification.json"].map((path) => ({ path, source_section: path.replace(/\.md$|\.json$/, ""), purpose: detail(`Provide the authoritative ${path} specification section for bounded coding review`), implementation_status: path === "idea-specification.json" ? "machine_specification" : "documentation_only" })), generated_source_sections: list("Generated from the complete validated specification without executable authority"), implementation_status: "plan_ready", initial_branch: "main", code_generation_begins_automatically: false, sanitisation_requirements: list("Remove secrets, personal data, executable instructions, and untrusted repository content"), prohibited_content: list("No credentials, public visibility, automatic implementation, or trusted prompt instructions"), creation_verification: list("Verify every declared documentation file exists in a private repository") },
  };
  return { ...base, ...overrides };
}

test("manual and scheduled counts are constrained", () => {
  assert.equal(expectedIdeaCount("1"), 1);
  assert.equal(expectedIdeaCount("3"), 3);
  assert.throws(() => expectedIdeaCount("2"));
  assert.equal(compactSeedSchema(1).properties.ideas.maxItems, 1);
});

test("Gemini receives a compatible response-schema projection while local schema stays strict", () => {
  const authoritative = { type: "object", minProperties: 1, additionalProperties: false, properties: { nested: { type: "object", minProperties: 1, additionalProperties: true } } };
  const gemini = providerSchema(authoritative, "gemini");
  assert.equal(authoritative.minProperties, 1);
  assert.equal(authoritative.additionalProperties, false);
  assert.equal(gemini.minProperties, undefined);
  assert.equal(gemini.additionalProperties, undefined);
  assert.equal(gemini.properties.nested.minProperties, undefined);
  assert.equal(gemini.properties.nested.additionalProperties, undefined);
});

test("Gemini structured output receives the compatible response schema", () => {
  const previousKey = process.env.AI_API_KEY;
  const previousModel = process.env.AI_MODEL;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "gemini-test";
  try {
    const request = providerRequest("Return one object", { type: "object", minProperties: 1, properties: { name: { type: "string" } } }, "gemini");
    const payload = JSON.parse(request.init.body);
    assert.equal(payload.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(payload.generationConfig.responseSchema, { type: "object", properties: { name: { type: "string" } } });
  } finally {
    if (previousKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previousModel;
  }
});


test("candidate filtering happens before expansion and keeps distinct greenfield work", () => {
  const candidates = [
    { application_name: "Private training timer", repository_slug: "private-training-timer", product_definition: detail("A recurring local training timer that captures interval evidence and checks a personal progression plan"), problem: detail("Athletes repeatedly lose interval history and cannot compare their planned and completed recovery periods"), target_user: detail("A solo lifter who trains several times weekly"), smallest_experiment: detail("A local command-line timer with two interval templates") },
    { application_name: "Private training timer remix", repository_slug: "private-training-timer-remix", product_definition: detail("A recurring local training timer that captures interval evidence and checks a personal progression plan"), problem: detail("Athletes repeatedly lose interval history and cannot compare their planned and completed recovery periods"), target_user: detail("A solo lifter who trains several times weekly"), smallest_experiment: detail("A local command-line timer with two interval templates") },
    { application_name: "Invoice evidence inbox", repository_slug: "invoice-evidence-inbox", product_definition: detail("A local intake application that classifies invoices into an evidence-backed review queue for recurring monthly bookkeeping"), problem: detail("Freelancers repeatedly lose track of invoice evidence before their monthly finance review"), target_user: detail("A privacy-conscious independent worker with monthly bookkeeping"), smallest_experiment: detail("A local import command that validates two invoice record types") },
  ];
  assert.equal(selectSeeds(candidates, 2).length, 2);
});

test("incomplete technical-sales-style specifications are rejected", () => {
  const idea = validIdea({ application_name: "Technical Sales Pitch Architect", repository_slug: "technical-sales-pitch-architect" });
  idea.domain_model.entities = [];
  assert.throws(() => validateIdea(idea, 0), /domain entity/);
});

test("security, permission, and recovery contracts follow the schema list shape", () => {
  const idea = validIdea();
  idea.security_and_privacy = detail("A string where the authoritative schema requires an explicit list");
  assert.throws(() => validateIdea(idea, 0), /security_and_privacy.*list/i);
});

test("mechanical missing scoring identifiers are derived from provider-authored names", () => {
  const idea = validIdea();
  delete idea.scoring_and_decision_logic.dimensions[0].id;
  delete idea.evaluation_rubric.dimensions[0].id;
  const canonical = canonicalizeStructuralIds(idea);
  assert.equal(canonical.scoring_and_decision_logic.dimensions[0].id, "evidence-completeness");
  assert.equal(canonical.evaluation_rubric.dimensions[0].id, "evidence-completeness");
  assert.equal(validateIdea(canonical, 0).application_name, "Local Evidence Ledger");
});

test("concise but schema-valid domain and subsystem names remain accepted", () => {
  const idea = validIdea();
  idea.domain_model.entities[0].name = "Timer";
  idea.subsystem_contracts[0].name = "Clock";
  idea.coding_agent_handoff.subsystem_contract_references[0] = "Clock";
  assert.equal(validateIdea(idea, 0).domain_model.entities[0].name, "Timer");
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

test("empty contracts, invalid weights, and phase one blockers are rejected precisely", () => {
  const emptySchema = validIdea();
  emptySchema.subsystem_contracts[0].input_schema = {};
  assert.throws(() => validateIdea(emptySchema), /input_schema is empty/);
  const invalidWeight = validIdea();
  invalidWeight.evaluation_rubric.dimensions[0].weight = 0.75;
  assert.throws(() => validateIdea(invalidWeight), /weights total/);
  const blocker = validIdea();
  blocker.unresolved_questions[0].blocks_phase_1 = true;
  assert.throws(() => validateIdea(blocker), /unresolved_questions/);
});

test("quality, distinctiveness, repository plan, and handoff reject thin contracts", () => {
  const quality = validIdea();
  quality.quality_gate.overall_score = 3;
  assert.throws(() => validateIdea(quality), /overall_score|pass\/fail decision/);
  const duplicate = validIdea();
  duplicate.distinctiveness.uniqueness_verdict = "duplicate";
  assert.throws(() => validateIdea(duplicate), /does not establish/);
  const repository = validIdea();
  repository.repository_plan.visibility = "public";
  assert.throws(() => validateIdea(repository), /visibility must be private/);
  const handoff = validIdea();
  handoff.coding_agent_handoff.acceptance_criterion_ids = ["AC-99"];
  assert.throws(() => validateIdea(handoff), /undefined acceptance criterion/);
});
