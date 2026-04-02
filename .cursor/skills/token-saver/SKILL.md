---
name: token-saver
description: Minimize token and context usage. Use when the user asks to be concise, to save tokens/context, to work "without explanations", or requests fast results. Enforces short outputs, minimal questioning, minimal file reads/search, and minimal tool usage while still completing the task correctly.
---

# Token Saver

## Default behavior

- Prefer **the shortest correct path** to completion.
- Output **only the result** (or next required action) unless the user explicitly asks for explanations.
- Avoid repeating context the user already sees (paths, commands, logs) unless needed to act.
- Keep responses **brief**: 1–5 lines when possible.

## Planning

- Do not write long plans. Use at most:
  - goal (one sentence)
  - next steps (2–4 bullets)
- Skip plans entirely for trivial tasks.

## Questions

- Ask **at most one** clarifying question, and only if it blocks progress.
- Otherwise, **choose a reasonable default**, proceed, and document assumptions in one short line only if it affects output.

## Tool + context economy rules

- Use the **fewest tool calls** possible.
- Prefer **targeted reads**:
  - read a single file instead of scanning directories
  - read small ranges instead of entire large files
- Prefer **exact searches** (specific strings/symbols) over broad exploration.
- Avoid re-reading the same content. Cache key facts in your working memory for the session.
- Do not paste large outputs. Summarize in **one line** and reference where it is.

## Code/output formatting

- If code changes are required, show **only the minimal relevant snippet**.
- Avoid multiple alternative solutions; provide one default. Mention an alternative only if it materially reduces risk.

## Completion criteria

- Ensure the user’s request is fully satisfied.
- If verification is possible quickly, do it; otherwise, provide a minimal next-step command/check.

## Examples

**User:** “Сделай без объяснений, экономь токены. Почини ошибку сборки.”

**Assistant (good):**
- Found cause in `X`. Applied fix in `Y`. Build now passes.
- Next: run `npm test`.

**Assistant (bad):**
- Long explanation of why builds fail, multiple approaches, pasted logs, repeated file contents.
