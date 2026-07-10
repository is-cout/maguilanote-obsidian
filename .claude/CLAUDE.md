# Claude Instructions

## Mandatory Pre-Task Checklist

Before responding to any coding task, read the relevant instruction files:

**Always read (generic — apply to all Unity work):**
1. [Response Verbosity](instructions/caveman.instructions.md)
2. [Living Documentation](instructions/living-docs.instructions.md)

**Read when doing git/commit/release work:**
3. [Git Workflow & Commits](instructions/git.instructions.md)

Start your response by listing which files were read.

---

## Language Policy

All instruction files, skill files, and code comments intended for contributors must be written in **English**.

---

## Engineering Rules

These rules apply to every task unless explicitly overridden.

### Think Before Coding
State assumptions explicitly. If uncertain, ask — don't guess. Present multiple interpretations when ambiguity exists. Push back when a simpler approach exists. Stop when confused and name what's unclear.

### Simplicity First
Minimum code that solves the problem. Nothing speculative. No features beyond what was asked. No abstractions for single-use code. Test: would a senior engineer say this is overcomplicated? If yes, simplify.

### Surgical Changes
Touch only what you must. Clean up only your own mess. Don't "improve" adjacent code, comments, or formatting. Don't refactor what isn't broken. Match existing style.

### Read Before You Write
Before adding code, read exports, immediate callers, and shared utilities. "Looks orthogonal" is dangerous. If unsure why code is structured a certain way, ask.

### Zoom Out When Unfamiliar
When unfamiliar with an area of code, or when the user asks how something fits into the bigger picture: go up a layer of abstraction and map all relevant modules and callers using the project's domain vocabulary before answering.

### Goal-Driven Execution
Define success criteria before starting. Loop until verified. Don't follow steps blindly — define what done looks like and iterate toward it.

### Surface Conflicts, Don't Average Them
If two patterns contradict, pick one (more recent or more tested). Explain why. Flag the other for cleanup. Don't blend conflicting patterns.

### Tests Verify Intent
Tests must encode WHY behavior matters, not just WHAT it does. A test that can't fail when business logic changes is wrong.

### Checkpoint After Significant Steps
Summarize what was done, what's verified, and what's left. Don't continue from a state you can't describe clearly.

### Match Codebase Conventions
Conformance over personal taste inside the codebase. If you think a convention is genuinely harmful, surface it — don't fork silently.

### Fail Loud
"Completed" is wrong if anything was skipped silently. "Tests pass" is wrong if any were skipped. Default to surfacing uncertainty, not hiding it.

---

## Dependency Policy

All dependency versions in `package.json` are pinned **exactly** (no `^`/`~` ranges). Never install `@latest`, never run an automatic update (`npm update`, bumping a version "while at it"), and never bump a version without asking Lucas first and getting explicit approval — even for a patch release. If a security issue is found, flag it and propose the fix; don't apply it silently. See [docs/DEPENDENCIES.md](../docs/DEPENDENCIES.md) for the current pins and rationale.

## Documentation Policy

README and `docs/` are living documents. Every significant change (feature, board file format, dependency, settings/defaults, build process) gets its documentation updated and a [docs/CHANGELOG.md](../docs/CHANGELOG.md) entry in the same change — see [Living Documentation](instructions/living-docs.instructions.md) for the full rule.

## Versioning Policy

The plugin version follows Semantic Versioning 2.0.0. **Only changes to the shipping plugin (`src/**`, `styles.css`, user-facing `manifest.json` fields) bump the version** — docs, README, tooling, and dev-dependency changes do not. See [Versioning](instructions/versioning.instructions.md) for the MAJOR/MINOR/PATCH rules, the Obsidian `x.y.z` constraint, and the three files to keep in sync.

---

## Memory and Context Files

- **[MEMORY.md](MEMORY.md)** — Claude's persistent memory index. Auto-updated across sessions.
