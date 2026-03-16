Purpose
This file provides operational rules for AI coding agents (Claude Code, Cursor, Copilot, Aider).
Agents must follow these instructions to produce safe, predictable, minimal changes.

Instruction priority:
1. Direct user instruction
2. This AGENTS.md
3. Existing repository patterns

Operating Principles
Agents must behave like a careful engineer.

Always:
- read nearby code before editing
- match existing patterns
- make small focused changes
- prefer minimal diffs
- stop and report errors instead of guessing

Never:
- refactor unrelated code
- introduce large rewrites
- change architecture without instruction

Diff Size Guardrail
Agents should keep changes small.

Preferred limits:
- < 200 lines changed
- < 5 files modified

If larger work is required:
- explain why
- propose the plan
- wait for approval

Project Structure
Example structure:

src/
components/
lib/
hooks/
api/
tests/

Guidelines:
- UI -> components
- business logic -> lib
- hooks -> hooks
- API handlers -> api
- tests -> tests

Do not create new top-level folders unless required.

Commands
Use these commands to validate work.

```bash
npm run dev
npm run build
npm run lint
npm run test
npx tsc --noEmit
```

Before finishing work run:
- npm run build
- npm run lint

Do not claim tests passed unless executed.

Editing Rules
When editing code:
- modify only what the task requires
- preserve formatting and structure
- reuse existing utilities
- avoid renaming symbols unnecessarily
- avoid introducing new dependencies

Prefer extending existing modules over creating duplicates.

Architecture Awareness
Before writing code, agents should identify:
- where similar functionality already exists
- the module responsible for the domain
- existing utilities that solve similar problems

Avoid creating parallel implementations.

Boundaries
Agents must never modify or expose:
- .env
- .env.local
- node_modules
- dist
- build

Never expose:
- API keys
- credentials
- tokens
- service role secrets

Never move server logic into client code.

Database Safety
Database changes are high risk.
Agents must not:
- drop tables
- rename columns
- delete data
- run destructive migrations

Unless explicitly requested.

When schema changes are required:
Agents must explain:
- affected queries
- affected API routes
- affected UI components

Migration Rules
When migrations are required:
- prefer additive changes
- preserve backward compatibility
- avoid destructive edits

Never rewrite migration history.

Dependency Policy
Prefer the existing stack.
Do not install packages for functionality already provided by:
- the framework
- the language
- existing libraries

If a dependency is necessary:
Explain:
- why it is required
- why existing tools cannot solve the problem

Git Rules
Run git commands one at a time.
Stop immediately if a command fails.

Agents must not automatically:
- force push
- reset
- rebase
- amend commits
- delete branches

Do not run git commands if the working tree is dirty.

Pull Request Workflow
When preparing a PR:
- confirm working tree is clean
- `git status`
- show outgoing commits
- `git log --oneline main..HEAD`
- push branch
- `git push -u origin HEAD`
- create PR with explicit title and body

Never rely on auto-generated PR text.

Debugging Rules
When fixing bugs:
- reproduce the issue
- identify root cause
- implement minimal fix
- validate with build/tests

Avoid speculative fixes.
Change one variable at a time.

Performance Guardrails
Avoid:
- unnecessary renders
- repeated network requests
- heavy computation inside render loops

Prefer simple predictable optimizations.
Do not prematurely optimize.

Documentation Rules
Update docs when:
- commands change
- setup changes
- APIs change
- architecture changes

Do not leave outdated documentation.

Known Agent Mistakes
Avoid these common problems:
- replacing native <select> elements unnecessarily
- introducing new UI frameworks
- renaming files without reason
- rewriting working patterns
- creating duplicate utilities

Definition of Done
A task is complete when:
- requested change is implemented
- build succeeds
- lint passes
- project conventions are followed
- no unrelated files were modified

Future Extensions
Mature AI repos often add:
- architecture diagrams
- API conventions
- event naming rules
- auth rules
- billing rules
- observability rules
- deployment checklist

Final Rule
Act like a careful teammate.
Understand first.
Make minimal changes.
Validate results.
Communicate clearly.
