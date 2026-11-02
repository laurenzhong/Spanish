# CONV-EVAL-007 acceptance-tier decision

Date: 2026-11-02

The owner accepted a tiered interpretation of the existing acceptance conditions. The conditions are not reduced; they are separated by purpose.

## Web Alpha hard gate

007 may close only when evidence for the same latest deployment pin proves:

1. The public root, manifest, and unauthenticated API boundary are reachable.
2. The page's own OTP flow creates a real authenticated session that can enter Lucía and complete the basic conversation read/send/finish path.
3. A disposable account supports an auditable 100-message long-history stress run, first-history-request failure followed by retry, and refresh recovery. The 100 messages test pagination and state recovery; it is not a product prerequisite for ordinary users. Synthetic release fixtures and old-pin runs do not count.
4. Disconnect, retry, cancel, and error recovery do not let an old generation update the current session.
5. Desktop and Mobile Web core paths have no material horizontal overflow.
6. The disposable account's session, conversation/messages, and Storage data can be cleaned up, and the old session is rejected afterward.
7. No unresolved P1 security, privacy, data-integrity, or authentication blocker remains.

## Deferred overall-confidence observations

iPhone Safari/PWA background recovery, longer-term performance, broader real-user sampling, and long-run model language naturalness remain separately tracked observations. They are not current 007 closure conditions, and removing them from the Web Alpha gate does not weaken the authentication, privacy, data-integrity, or P1 security requirements.

This decision changes the interpretation of the gate, not the evidence already obtained. 007 remains open until the Web Alpha hard-gate evidence exists for the same latest pin.
