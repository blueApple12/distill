# Constraint-First Question Tree Design

Date: 2026-08-15
Status: Approved for implementation

## Goal

Replace the current bounded greedy algorithm with an exact solver that always treats `MAX NOs` and `STOP AT` as hard constraints. The solver must use no exclusions when `EXCL` is off, search as many questions as necessary, and minimize the worst-case number of questions among all valid trees.

Balanced and Precision may choose different question orders, but they must never change whether a word list is feasible or how many exclusions are genuinely required.

## Required Priority Order

Every solver decision follows this lexicographic priority:

1. Every terminal leaf contains at most `STOP AT` words.
2. Every root-to-leaf path contains at most `MAX NOs` negative binary answers. A value of zero means unlimited NO answers.
3. Apply no exclusions when `EXCL` is zero. When the user selects `EXCL = K`, apply exactly `K` exclusions, clamped so at least one word remains.
4. Minimize the maximum number of questions on any root-to-leaf path.
5. Use the selected mode only to choose among equally short valid trees.

Balanced prefers lower expected depth and more even partitions. Precision prefers fewer expected NO answers and higher-YES binary questions. Neither mode may filter feasible questions or affect feasibility and exclusion calculations.

## Question Polarity

Every enabled binary question may be asked in its normal or logical reverse form. Both forms share one base question identity, so a path cannot ask both versions of the same question.

Reversing a question swaps its YES and NO partitions and inverts its predicate. Built-in questions receive natural reverse wording, for example:

- `Contains "A"?` becomes `Does not contain "A"?`
- `Exactly 5 letters?` becomes `Not exactly 5 letters?`
- `Is the 2nd letter "A"?` becomes `Is the 2nd letter not "A"?`
- `Any letter appears more than once?` becomes `Are all letters unique?`

Custom binary questions use the explicit form `NOT — <question>` so the meaning remains unambiguous. Cup questions are multi-way classifications and are not reversed.

## Exact Solver

The solver uses iterative deepening over the allowed worst-case depth. It asks whether a valid tree exists at depth 0, then 1, 2, and so on. The first successful depth is therefore the proven minimum worst-case question count.

For each state, the solver tracks:

- the current candidate-word set;
- the number of NO answers already used on that path;
- the remaining depth allowance;
- the enabled question catalogue and algorithm settings.

A state succeeds immediately when its candidate count is at most `STOP AT`. It fails when no depth remains, no question produces a real split, or every possible split violates the NO budget.

For a normal binary question, the YES child keeps the current NO count and the NO child adds one. A reversed question swaps those branches. A question is rejected unless every non-empty child can be solved within the same hard constraints. When the NO budget is exhausted, binary questions cannot be asked; cup questions may continue because they do not consume a NO.

The search deduplicates questions that produce the same partition, memoizes equivalent states, applies safe lower-bound pruning, and orders candidates by the selected mode. Search ordering affects which equal-depth solution is returned, not the proven depth or validity.

There is no fixed six-question or twenty-question correctness cutoff. Finite question and candidate sets guarantee eventual completion. Expensive searches may take time, but the app never substitutes an invalid heuristic result.

## Worker and Application Data Flow

All exact solving runs in a Web Worker. Each request has an input signature and request identifier. Changing words or settings cancels or supersedes the previous request, and stale worker responses are ignored.

The worker returns a solution object containing:

- status: `solved` or `impossible`;
- the authoritative decision tree when solved;
- proven worst-case depth;
- leaf and NO-budget validation metadata;
- applied exclusions;
- optional or required exclusion advice;
- up to eight equally optimal tree or exclusion variants where practical.

The primary zero-exclusion tree is returned before optional exclusion advice when possible. This lets the interface become usable while the worker continues lower-priority suggestion work.

While an input signature has no proven result, Tree and Trainer show `Optimizing…`. They must not use the previous settings' tree. If Worker construction is unavailable, the interface reports that optimization is unavailable instead of silently running a long blocking calculation on the phone's main thread.

## Shared Tree Consumption

Tree View, Answer Trainer, and Guess Trainer all consume the same authoritative tree.

Answer Trainer displays the current tree node and follows the child matching the user's answer. Guess Trainer chooses a secret and simulates answers through the same nodes. Neither mode calls an independent greedy `pickQ` function.

At a leaf, Trainer reveals the remaining candidates. The existing twenty-question cutoff and the behavior that stops immediately upon reaching the NO limit are removed. Reaching a leaf is the only normal completion condition, and solver construction guarantees both hard constraints there.

If an unexpected answer has no matching child, Trainer ends with a clear no-match state rather than inventing another question.

## Exclusion Behavior

When `EXCL` is zero:

- no words are removed;
- a valid tree is used regardless of how many questions it requires;
- if its proven worst-case depth is greater than five, the app may calculate and display an optional exclusion shortcut;
- optional advice is never labeled `needed` and never changes the effective word list.

Optional advice finds the smallest exclusion count that can produce a valid tree with worst-case depth at most five. If no such set exists within the supported EXCL range, the interface does not make a misleading suggestion.

If no zero-exclusion tree exists under the enabled questions and hard constraints, the worker searches for the minimum exclusion count that makes a valid tree possible. This is labeled `required`, but it is still not applied until the user changes EXCL.

When the user selects `EXCL = K`, the worker chooses the K-word subset whose remaining list has the smallest valid worst-case depth. Hard constraints remain more important than depth, and mode remains only a final tie-breaker.

Required and optional exclusion counts are calculated without mode preferences. Consequently, switching between Balanced and Precision cannot change either count.

## Interface Changes

The existing controls remain. Their behavior and labels change as follows:

- The EXCL badge says `<N> suggested` for an optional five-question shortcut.
- It says `<N> required` only after zero-exclusion infeasibility is proven.
- Tree and Trainer show a compact `Optimizing…` state while waiting for a matching solution.
- An impossible configuration explains that the enabled questions cannot satisfy both MAX NOs and STOP AT and shows the minimum required exclusions when known.
- Reversed questions are visibly worded as reversed questions; YES and NO retain their ordinary meanings.

## Testing Strategy

Implementation follows test-driven development. Tests are written and observed failing before production changes.

Pure algorithm tests will cover:

- a list that needs more than six questions but needs no exclusions;
- validation of every leaf's `STOP AT` size;
- validation of the NO count on every root-to-leaf path;
- continued cup-question use after the binary NO budget is exhausted;
- normal and reversed question polarity;
- identical feasibility and exclusion counts in Balanced and Precision;
- different mode ordering only among equally short valid trees;
- the minimum worst-case depth, checked against an independent brute-force oracle on small word sets;
- optional advice for trees deeper than five without applying exclusions;
- minimum required exclusions for a proven impossible zero-exclusion case;
- exact user-selected exclusion counts and optimal resulting depth;
- zero as unlimited MAX NOs.

Integration tests will prove that Tree View, Answer Trainer, and Guess Trainer traverse the same solution, and that stale worker replies cannot replace a newer result.

Performance checks will use representative lists on the worker path. The correctness search may remain computationally expensive, but main-thread interaction, scrolling, and swiping must stay responsive throughout it.

## Acceptance Criteria

The work is complete when:

- no generated or trained path violates MAX NOs or STOP AT;
- the solver proves the minimum worst-case question depth;
- no fixed depth cutoff causes false exclusion advice;
- EXCL off never removes words;
- mode changes never change required or suggested exclusion counts;
- reversed questions can make previously impossible trees valid;
- all three consumers use the same solved tree;
- the complete automated test suite and production build pass;
- mobile interaction remains responsive while optimization runs.
