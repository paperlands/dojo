--------------------------- MODULE SliceScope ---------------------------
\* probe-status: concluded
EXTENDS Naturals, Sequences

CONSTANTS Nesting, Restore
VARIABLES callers, deadline

vars == <<callers, deadline>>

\* The sequence specifies lexical owners; the JS implementation needs only
\* one saved value in each call, not an additional runtime stack.
Init == /\ callers = <<>>
        /\ deadline = 0

Enter(d) ==
    /\ Len(callers) < Nesting
    /\ callers' = Append(callers, d)
    /\ deadline' = d

Leave ==
    /\ Len(callers) > 0
    /\ callers' = SubSeq(callers, 1, Len(callers) - 1)
    /\ deadline' = IF Restore /\ Len(callers) > 1
                   THEN callers[Len(callers) - 1] ELSE 0

Next == Leave \/ (\E d \in 0..2 : Enter(d))
Spec == Init /\ [][Next]_vars

ScopedDeadline ==
    deadline = IF Len(callers) = 0 THEN 0 ELSE callers[Len(callers)]
===========================================================================
