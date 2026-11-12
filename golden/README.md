# Golden cases

Each file in `cases/` is one scenario with the answer a planner would give. `npm run golden` (and `npm test`) runs them all, so a change to the engine cannot quietly change an outcome. `npm run golden` also lists the GPDO provisions that **no case exercises yet**.

The legislation cases were written from the legislation text and national technical guidance (`kind: "legislation"`, `basis` names the paragraph). They prove the engine does what the rules say. They do **not** prove it agrees with councils. For that, add real decisions.

## Adding a real council decision (the strongest kind)
1. Copy `_TEMPLATE.json.example` to `cases/<short-id>.json`.
2. Put the council's reference and decision date in `basis` (for example `LPA ref 24/01234/HHPA, prior approval granted 2024-03-02`) and set `"kind": "decision"`.
3. Fill `input` with the facts of that scheme (use the same fields as the proposal form) and `expect.verdict` with what the council decided:
   `permitted_development` (certificate of lawfulness granted), `prior_approval` (prior approval application), `planning_permission` (refused as PD / full application needed).
4. Run `npm run golden`. If it fails, either the engine is wrong or a fact is missing from the input; the output says which check disagreed.

Public sources: council planning portals (search "lawful development certificate" and "larger home extension"), and PlanIt.

## Case format
```json
{ "id": "...", "title": "...", "kind": "legislation | decision", "basis": "where the expected answer comes from",
  "type": "assess", "input": { "country": "England", "houseForm": "terraced", "proposal": { "type": "rear_extension", ... } },
  "expect": { "verdict": "prior_approval", "confidence": "needs_confirmation", "checks": { "rear-depth": "warn" }, "absent": ["side-width"] } }
```
`type: "site"` cases describe a plan in metres (x east, y north) as `[x0, y0, x1, y1]` boxes: `house`, `proposal`, `neighbours`, `plot`, and expect `walls: { "east": "touches_neighbour" }`, `wallSafety`, `items` (regular expressions).

## Real decisions so far

Three cases come from published decisions (`kind: "decision"`, the `basis` field gives the reference, date and outcome). Where a decision did not state a figure, the case uses a placeholder and says so in `basis`: only the facts the decision gave are being tested. The engine agrees with all three on the point decided. Highdown Road is also tested on A.1(e), and Eastfield Drive on A.2(a) (rendering on article 2(3) land).

Existing roof heights can now also come from a measured survey (`existingRoof.source: "survey"`, with a tight `toleranceM`). LiDAR alone (±0.5 m) cannot settle a 0.15 m eaves difference such as the Rosslyn Avenue appeal.
