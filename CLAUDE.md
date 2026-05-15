# DISTILL — Claude.md

## What is DISTILL?

A single-file React mentalism app where a performer prepares a word list and guides a spectator through yes/no and multi-choice questions to identify their mentally chosen word. Two views: **HUNT** (live interactive questioning) and **TREE** (SVG decision tree visualization).

**Deployed:** https://blueapple12.github.io/distill/
**Repo:** https://github.com/blueapple12/distill
**GitHub user:** blueapple12

---

## Deployment

After ANY change to src/App.jsx or other files:
```bash
npm run deploy
```

This runs `npm run build` then `gh-pages -d dist`. Always verify the change appears on the live URL—browser cache or GitHub Pages cache can delay updates.

---

## Project structure

```
src/App.jsx          — entire app (~760 lines, component styles inline)
src/App.css          — component-specific styles (optional, currently minimal)
src/index.css        — global styles, animations, fonts, layout classes
src/main.jsx         — React entry point (don't touch)
vite.config.js       — has base: '/distill/' for GitHub Pages
index.html           — title: DISTILL, theme-color: #0d061c
```

---

## Tech stack (strict)

- **React only**: useState, useEffect, useCallback, useRef
- **No TypeScript, no CSS modules, no external UI libraries, no router, no state management**
- **Styles**: Mostly inline JSX objects in components + global CSS in src/index.css
- **CSS files**:
  - `src/index.css` — global styles, animations, fonts, layout classes, media queries
  - `src/App.css` — component-specific styles (optional)
- **Fonts**: Space Mono and Noto Sans Hebrew, loaded via Google Fonts in index.css
- **Only external packages**: react, react-dom, @vitejs/plugin-react (prod), gh-pages (devDependency)

---

## Architecture overview

### Pure functions (top of App.jsx)

**buildQs(words, allowed)**
- Builds question pool from word list
- Five question types, all toggleable via `allowed` object:
  - `contains`: "Contains E?" (binary, priority 0)
  - `length`: "Exactly 4 letters?" (binary, priority 1)
  - `dupe`: "Any letter appears more than once?" (binary, priority 1)
  - `position`: "Is the 2nd letter T?" (binary, priority 2—highest tiebreak)
  - `cups`: "How many letters?" (multi-choice, priority 1)
- Only positions existing in word list are generated
- All question text always English (even for Hebrew word lists)

**pickQ(rem, mode, asked, maxNOs, noUsed, allowed)**
- Picks best next question from remaining words
- `50/50` mode: maximizes entropy (balanced YES/NO)
- `SNIPER` mode: maximizes YES ratio + surgical bonus (±0.15 if 1 NO, ±0.08 if 2 NO)
- Budget exhausted (noUsed >= maxNOs): score += 10, becomes pure YES maximizer
- Tiebreak: position > length/dupe > contains
- YES floor filter only in SNIPER mode, never 50/50
- Falls back to any question that splits pool if all filtered

**buildTree(words, mode, asked, maxNOs, noUsed, depth, stopAt, allowed)**
- Recursive tree builder
- YES branch: noUsed unchanged
- NO branch: noUsed + 1
- Stops at: depth 6, words.length <= stopAt, noUsed >= maxNOs, or no valid question

**countTreeQ(words, mode, maxNOs, stopAt, allowed)**
- Counts total questions across entire tree
- Used by exclusion algorithm

**findExclusions(words, mode, maxNOs, stopAt, maxExclude, allowed)**
- Greedy: each round removes word leaving fewest total tree questions
- Repeats maxExclude times, always fills budget (never stops early)
- At maxExclude=0, just computes badge count without picking words
- Returns: `{ toExclude[], count, totalNeeded, neededToAdd, fullyFixed, badLeaves }`

**TreeView component**
- Renders SVG flowchart
- Diamonds = binary questions
- Green-bordered rounded rects = CUPS questions
- Regular rects = leaf nodes with word lists
- Arrows with YES/NO/number labels
- PNG export: draws at 2x scale with dark background (#090914)

### State variables (in App component)

```javascript
mode              // '5050' | 'sniper'
allowed           // { cups, length, contains, position, dupe }
maxNOs            // 0–8 (0 = no limit)
stopAt            // 1–8 (default 2)
maxExclude        // 0–10
exclSugg          // result of findExclusions
words             // string[] (raw word list)
phase             // 'idle' | 'q' | 'guess' | 'result'
remaining         // words in play
asked             // Set of question IDs used this game
curQ              // current question object
qn                // question count
noUsed            // NOs used this game
hist              // array of { q, ans, before, after, isNo, type }
guesses           // candidates shown at end
viewMode          // 'hunt' | 'tree'
mobilePanel       // 'settings' | 'view'
showList, showSaved, showQDrop, showHist, showDbg  // toggles
savedList         // saved anagram configs from localStorage
```

### Key derived values (computed every render)

```javascript
wl = [...new Set(words)]                        // deduplicated
excluded = exclSugg?.toExclude || []
effectiveWl = wl.filter(w => !excluded.includes(w))
heb = isHebrew(words[0])                        // drives RTL, font, alphabet
modeColor = C.blue                              // same for both modes
T2 = { pri, sec, priDim, priBorder, secDim, secBorder, bg, card, border }
```

### Theme system (T2)

**HUNT view** (purple dominant):
- pri: #9b6dff (purple)
- sec: #7adf2e (green)
- bg: #0d061c, card: #150c2a, border: rgba(160,120,255,0.15)

**TREE view** (green dominant):
- pri: #7adf2e (green)
- sec: #9b6dff (purple)
- bg: #041204, card: #081a08, border: rgba(100,200,80,0.18)

Background glow: two fixed radial divs (top-right, bottom-left) swap colors by viewMode. Positioned at 10%/5% inset so visible on phones.

CSS class `.tx`: `transition: background 0.4s, border-color 0.4s, color 0.4s`

---

## Layout

**Desktop** (>640px): two-column flex. Sidebar 260px, main fills rest.
**Mobile** (≤640px): full-width panels, bottom tab bar (SETTINGS | VIEW), swipe left/right (50px threshold).
- Class `mob-hide` hides inactive panel
- Class `mob-bar` hidden on desktop

**Sidebar** (top to bottom):
1. DISTILL logo (color = T2.pri, underline = T2.sec)
2. VIEW toggle: HUNT | TREE
3. Settings card: MODE, QUESTIONS dropdown, ALGORITHM controls, WORDS
4. Word list (toggleable): input, chips, save/load buttons

**Main**:
- Word list editor (showList): word chips with remove, save controls
- Saved anagrams (showSaved): sorted newest first, tap to load
- TREE view: tags + TreeView SVG + PNG button
- HUNT idle: summary + "I HAVE A WORD →"
- HUNT questioning: status strip, confidence bar, question card, answer buttons, HIST/DBG
- HUNT guess: candidates as buttons, first highlighted
- HUNT result: question log, AGAIN / BACK buttons

---

## Game flow

```
idle → startGame() → uses effectiveWl → picks first question
q phase → handleAnswer(val) → filter remaining → pick next question
```

Game ends when:
- remaining.length <= stopAt
- qn >= 20
- maxNOs limit hit
- no valid question available

Then moves to `guess` phase (show candidates) → tap any → `result` phase

---

## Persistence (localStorage)

Three helper functions (all try/catch wrapped):
- `lsGet(k)` — parse JSON or return null
- `lsSet(k, v)` — stringify and store
- `lsDel(k)` — remove key

**Index key**: `'anagram_index'` = array of IDs
**Item keys**: `'ag_TIMESTAMP'`
**Item schema**: `{ id, name, words[], mode, maxNOs, stopAt, maxExclude, allowed, savedAt }`

`applyAnagram(item, edit=false)` restores all settings including `allowed`.
**Backward compat**: checks `item.allowed` and `item.allowedQTypes` (old key name).

---

## Hebrew support

Auto-detected: `/[א-ת]/`

**Final-form normalization**: ך→כ ם→מ ן→נ ף→פ ץ→צ (via `nC` and `nW` functions)

**For Hebrew word lists**:
- Font: Noto Sans Hebrew
- Direction: rtl
- Alphabet: ALPHA_HE (Hebrew letters)
- Position/contains questions use Hebrew alphabet

**For English word lists**:
- Font: Space Mono
- Direction: ltr
- Alphabet: ALPHA_EN (English letters)

**Always**: Question text is in English regardless of language.

---

## EXCL (exclusion) badge logic

Shows on EXCL stepper when:
- maxExclude=0 and bad leaves exist: "N needed"
- maxExclude>0 and not fully fixed: "+N needed"
- Tree clean: nothing shown

Bad leaves = tree leaf nodes with more words than stopAt.

---

## Design decisions (locked in—do not revert)

1. **50/50 and SNIPER same purple color** — performer requested
2. **YES floor filter only in SNIPER, never 50/50** — 50/50 must freely pick balanced questions
3. **EXCL fills full budget always** — user sets it deliberately
4. **cupsOn state removed** — cups controlled by allowed.cups only
5. **All question text always English** — even for Hebrew word lists
6. **modeColor always C.blue** — regardless of mode
7. **findExclusions runs even at maxExclude=0** — for badge display
8. **effectiveWl computed every render, not stored** — keeps exclusion live
9. **Live re-filter during game** — useEffect on excluded.join(',')

---

## What does NOT exist (intentional removals)

- No cupsOn state
- No showSettings state
- No paste feature
- No gi state
- No handleGuess function (candidates go directly to result)
- No Repeat It Ploy phase
- No "more than N letters" questions
- No bigram questions
- No TypeScript
- No CSS files in use
- No external component libraries
- No router
- No sequential candidate guessing

---

## Common workflows

### Add a new question type
1. Add to `ALPHA_HE` / `ALPHA_EN` if needed
2. Create question object in `buildQs`: `{ id, type, priority, text, test/grp, cups }`
3. Add to `allowed` object in useState
4. Add toggle in QUESTIONS dropdown (around line 469)
5. Test with both English and Hebrew word lists

### Change colors/theme
Edit `C` object and `T2` computed theme. Changes affect both views instantly.

### Modify decision tree algorithm
Edit `pickQ`, `buildTree`, or `findExclusions`. Always test with word list that has bad leaves.

### Deploy after changes
```bash
npm run deploy
```
Wait 1–2 min, hard-refresh browser (Cmd+Shift+R / Ctrl+Shift+R), check live URL.

---

## Notes for future work

- App is intentionally minimal: no build-time magic, all runtime logic
- Inline styles keep everything in one place; CSS class `.tx` handles transitions
- localStorage backup means users don't lose custom word lists on browser clear
- SVG export includes excluded words in footer text
- Mobile UX relies on swipe and tab bar—test on actual phones
- Hebrew support is full but untested with mixed-language lists
- Game can end with no candidates (word not in list or user answer was wrong)

---

## Emergency fixes

**App shows old Vite template**: Check that index.html points to `src/main.jsx`, not `src/main.ts`. Check that src/App.css and src/index.css are **empty** (not with old template styles).

**CSS not applying**: Check both places:
1. Global styles in `src/index.css` (animations, fonts, layout classes .tx, .fade, .pop, .layout, .sidebar, .main)
2. Inline JSX style objects in `src/App.jsx` for component-specific styling
Make sure `src/index.css` is imported in `src/main.jsx`.

**localStorage not persisting**: Check browser dev tools > Application > Local Storage. Look for keys starting with `'ag_'`. If missing, saved anagrams were cleared.

**Tree view not updating**: Tree rebuilds on any change to `words`, `mode`, `maxNOs`, `stopAt`, `maxExclude`, or `allowed`. Check useEffect dependencies.
