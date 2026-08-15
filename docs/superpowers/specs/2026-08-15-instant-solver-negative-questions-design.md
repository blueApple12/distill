# Instant Solver and Negative Questions Design

## Goal

Return an exact valid tree for ordinary phone-sized lists without displaying a blocking optimization screen. If the enabled questions cannot distinguish all words, immediately show the mathematically minimum required exclusion count.

## Solver priorities

The solver uses this strict lexicographic order:

1. Satisfy `MAX NOs` and `STOP AT` on every path.
2. Respect the exact user-selected exclusion count; `EXCL off` keeps every word.
3. Prefer the negative-question tier: zero negatives, then at most one negative per path, then two or more while minimizing the worst-path negative count.
4. Minimize worst-case question depth within the selected negative tier.
5. Use Balanced or Precision only to break otherwise equal choices.

Negative questions are disabled by default. When disabled they are not solver candidates. When enabled they remain last-resort candidates under the priority order above.

## Exact fast solver

Replace repeated iterative-depth exploration with memoized subset dynamic programming. A state is the remaining word mask plus used-NO and negative-question counts. Each question produces strictly smaller child masks, so the recurrence is acyclic. The result stores the optimal serializable tree and objective tuple.

Before tree search, compute each word's complete answer signature. Identical signatures prove that no enabled question can separate those words. Their groups give a lower bound of `sum(group size - 1)` required exclusions. With `EXCL off`, this proof is calculated synchronously and shown immediately; no worker or optimization screen starts.

## UI and wording

- Add a `Negative questions` toggle under QUESTIONS, default off.
- Save and restore the toggle with saved configurations.
- Change the duplicate-letter question to `Do any letters repeat?`.
- While a valid input recalculates, keep the prior result visible instead of replacing the page with `Optimizing…`.
- Impossible inputs show `These rules cannot distinguish all words. At least X words must be excluded.`

## Verification

- Unit tests prove negative questions are absent by default and available when enabled.
- Tests prove zero-negative trees beat shorter negative trees, one-negative trees beat two-negative trees, and hard constraints remain dominant.
- The supplied 13-name Hebrew list with letter-count questions disabled returns its required exclusion count synchronously.
- Existing solver, exclusion, tree-session, build, and mobile behavior tests remain green.
