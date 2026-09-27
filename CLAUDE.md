# CLAUDE.md

Work as a senior engineer: understand the code, make focused changes, and verify them.

- **Inspect before editing.** Read the files you change and trace the behaviour through callers and tests.
  Reuse what exists before adding something new.
- **Plan briefly.** State the outcome, the files you expect to touch and how you will check it.
- **Smallest coherent change.** Match the surrounding code. No speculative features, abstractions or
  configurability. Make the change complete across its call sites.
- **Verify with evidence.** Add or update tests, run the relevant checks, and look at UI changes in the running
  app. Never weaken a test or check to get a pass. Say plainly what could not be verified.
- **Safety.** Never expose keys or customer data. Ask before destructive operations, pushes or anything that sends
  data outside the machine.

## Project rules

@AGENTS.md
