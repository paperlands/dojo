-------------------------- MODULE RevealPermit --------------------------
\* probe-status: concluded
EXTENDS Naturals

CONSTANTS Policy, Limit
VARIABLES run, held, H, settled, edge, sample

vars == <<run, held, H, settled, edge, sample>>
None == [run |-> 0, edge |-> 0, valid |-> FALSE]

\* edge and the sample's edge stamp are specification witnesses. The
\* invalidate policy does not consult stamps to decide whether it may spend.
Init == /\ run = 1 /\ edge = 0
        /\ held = FALSE /\ H = 0 /\ settled = TRUE
        /\ sample = None

Sample ==
    /\ sample = None /\ ~held
    /\ sample' = [run |-> run, edge |-> edge, valid |-> TRUE]
    /\ UNCHANGED <<run, held, H, settled, edge>>

RetireSample == IF Policy = "invalidate" /\ sample # None
                THEN [sample EXCEPT !.valid = FALSE] ELSE sample

ToggleHold ==
    /\ edge < Limit
    /\ held' = ~held /\ edge' = edge + 1
    /\ sample' = RetireSample
    /\ UNCHANGED <<run, H, settled>>

FreshPlay ==
    /\ edge < Limit
    /\ run' = run + 1 /\ edge' = edge + 1
    /\ held' = FALSE /\ H' = 0
    /\ sample' = RetireSample
    /\ UNCHANGED settled

SetSettlement == /\ settled' = ~settled
                 /\ UNCHANGED <<run, held, H, edge, sample>>

\* A sample conveys one arbitrary unit, not JS floating-point wall arithmetic.
\* The split models callbacks between measuring allowance and deciding to spend.
Spend ==
    /\ sample.valid /\ ~held /\ settled /\ H < Limit
    /\ (Policy # "runOnly" \/ sample.run = run)
    /\ H' = H + 1 /\ sample' = None
    /\ UNCHANGED <<run, held, settled, edge>>

Discard ==
    /\ sample # None /\ sample' = None
    /\ UNCHANGED <<run, held, H, settled, edge>>

Next == Sample \/ ToggleHold \/ FreshPlay \/ SetSettlement \/ Spend \/ Discard
Spec == Init /\ [][Next]_vars

\* Check the transition independently of how the model implements the guard.
SameRunSpend == [][H' > H => sample.run = run]_vars
SameEdgeSpend == [][H' > H => sample.edge = edge]_vars
HeldInert == [][held /\ run' = run => H' = H]_vars
===========================================================================
