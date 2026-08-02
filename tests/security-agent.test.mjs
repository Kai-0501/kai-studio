import test from "node:test";
import assert from "node:assert/strict";
import { securityPolicy } from "../src/lib/security-agent.ts";

test("Safeguard policy treats repository text as untrusted and requires explicit verdicts", () => {
  assert.match(securityPolicy, /untrusted evidence/i);
  assert.match(securityPolicy, /APPROVE, SANITIZE, REJECT, or ESCALATE/);
  assert.match(securityPolicy, /Publishing, pushing, deployment/i);
});
