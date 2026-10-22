# Ideas and improvement backlog

## Near-term
- Verify the GPay/PhonePe/Paytm notification path on a device (regexes are still guesses).
- Budget alerts and due-subscription reminders as push notifications (needs expo-notifications, native: next APK batch).
- "Bill due" SMS are ignored today; turn them into upcoming-bill reminders.
- Missed-transaction detector: a jump in "Avl bal" with no matching transaction suggests a missing SMS.
- Cash-flow forecast from subscriptions plus average daily spend.
- Anomaly checks: duplicate charges, unusually large spend per merchant.
- Split transactions, savings goals, net worth across accounts.
- Device smoke tests (Maestro) in CI.

## Learned parsing (ideation, far down the pipeline)
1. Cluster Unrecognised messages by masked template (digits, amounts, names replaced) to see which formats matter most.
2. Build a weak-supervision dataset: rule-parser output plus user Teach labels as ground truth, stored masked.
3. Evaluate leave-one-sender-out against the rules; a model must beat rules on unseen banks to be worth shipping.
4. A small on-device tagger (token classification: amount, merchant, account, direction) via TFLite in a native module, in a later APK. Rules stay first; the model only handles what rules reject.
5. Personalised category suggestions: k-NN over the user's confirmed history.
6. Any LLM use stays on-device or works only on masked templates with explicit opt-in.
7. A local "export masked corpus" tool to collect the dataset without raw personal data.
