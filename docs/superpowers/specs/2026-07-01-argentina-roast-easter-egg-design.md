# Argentina traitor-detector easter egg

## Goal

An in-joke for our all-Argentinean friend league: when someone fills in a knockout
prediction where **Argentina** is playing, and their inputs commit to Argentina
being knocked out, show a loud, stage-specific roast right in the prediction form.
Live, as-you-type — it appears the moment the pick is decisive against Argentina
and disappears if they change it back to Argentina advancing.

## Trigger logic

New pure function `argentinaRoast(input): string | null` in `src/lib/knockout.ts`.

Input mirrors what the form already feeds `knockoutOutcomeHint`, plus the stage:

```ts
export type ArgentinaRoastInput = {
  home: number | null;
  away: number | null;
  etHome: number | null;
  etAway: number | null;
  penAdvance: AdvanceSide | null;
  homeTeam: string;
  awayTeam: string;
  stage: string;
};
```

Rules, in order:

1. If neither `homeTeam` nor `awayTeam` is exactly `"Argentina"` → `null`.
2. Determine the **implied advancing side** from the current inputs, using the same
   semantics as scoring (`predictedAdvance`):
   - `home`/`away` blank → undecided → `null`.
   - `home !== away` → decisive 90'; winner = higher score.
   - draw at 90', ET blank → undecided → `null`.
   - draw at 90', `etHome !== etAway` → ET winner.
   - draw at 90', level ET, `penAdvance` set → the pen pick.
   - draw at 90', level ET, no pen pick → undecided → `null`.
3. If the implied winner **is** Argentina's side, or is undecided → `null`.
4. Otherwise return the message for `stage` from the table below. If the stage has
   no message (`GROUP_STAGE`, `THIRD_PLACE`) → `null`.

## Messages (verbatim, by stage)

| Stage | Text |
|---|---|
| `LAST_32` | `Que estas poniendo pelotudo?` |
| `LAST_16` | `Que te pasa la concha de tu hermana?` |
| `QUARTER_FINALS` | `Nah bueno, vos sos un sorete` |
| `SEMI_FINALS` | `Esta puteada preguntasela a Rodrigo, pero cuando termine el partido` |
| `FINAL` | `AH VOS SOS EL MAS PECHO FRIO. QUE ESTAS PONIENDO ACA HIJO DE PUTA?` |

`GROUP_STAGE` and `THIRD_PLACE` intentionally produce no roast: no message was
specified, and group advancement cannot be judged from a single match.

## Wiring

- `src/app/page.tsx`: pass `m.stage` to `MatchRow` via a new `stage` prop.
- `src/components/MatchRow.tsx`: accept `stage`, forward it to `KnockoutPredictionForm`.
- `src/components/KnockoutPredictionForm.tsx`: accept `stage`, call `argentinaRoast`
  with the same live `num()`-parsed inputs used for `knockoutOutcomeHint`. Render the
  result (when non-null) as a bold red line below the existing outcome hint. The
  normal outcome hint is unchanged.

## Testing

TDD on `argentinaRoast`:

- Argentina not in the match → `null`.
- Argentina predicted to win (90', ET, and pens) → `null`.
- Incomplete pick (draw at 90' with blank ET; level ET with no pen pick) → `null`.
- Each knockout stage's Argentina loss → its exact string.
- Argentina as home side vs away side both roast correctly.
- Loss via decisive 90', via decisive ET, and via penalties.
- `GROUP_STAGE` / `THIRD_PLACE` Argentina loss → `null`.

## Out of scope

- No roast in "everyone's picks" (form-only, per decision).
- No persistence, no scoring impact — purely cosmetic.
