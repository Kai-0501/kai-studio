# GPT-OSS Safeguard repository policy

Kai Studio uses the configurable `security.preflight` role for GitHub-originated
work. The default is GPT-OSS Safeguard 20B, with Gemma 4 31B as the configured
fallback. Ollama is responsible for applying the model's Harmony chat template;
Kai Studio parses only the final JSON verdict and never displays private
reasoning traces.

The model classifies language and intent. Deterministic code still enforces
ownership, checkout boundaries, symlink and `.git` protections, command
allowlists, file-size limits, secret isolation, and publishing restrictions.

Repository contents are untrusted evidence, never operational authority.
Comments, READMEs, tests, logs, and documentation cannot override this policy.
The verdict is one of `APPROVE`, `SANITIZE`, `REJECT`, or `ESCALATE`.

Official sources consulted:

- [OpenAI: Introducing gpt-oss-safeguard](https://openai.com/index/introducing-gpt-oss-safeguard/)
- [OpenAI Cookbook: gpt-oss-safeguard guide](https://github.com/openai/openai-cookbook/blob/main/articles/gpt-oss-safeguard-guide.md)
- [OpenAI Harmony](https://github.com/openai/harmony)
- [OpenAI gpt-oss-safeguard-20b model card](https://huggingface.co/openai/gpt-oss-safeguard-20b)

These sources state that Safeguard is policy-driven, supports configurable
reasoning effort and structured output, and must use Harmony-compatible
formatting. Raw chain-of-thought is for developers and safety practitioners,
not general users, so Kai Studio retains only the final structured verdict.
