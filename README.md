# Minsnooks V2 — UX prototype

A mobile-first, visual-only prototype for the approved Minsnooks league-table direction and sample fixtures, results, result-confirmation, stats, and knockout journeys. All names, dates, scores, graphs, and draw content are fictional.

This is not the V2 application: it has no backend, authentication, database, persistence, or real league operations. Buttons only simulate screens in the browser.

**For the next agent:** read [`HANDOFF.md`](HANDOFF.md) first. It includes the prior discovery decisions, safety constraints, approved prototype scope, open product questions, and suggested implementation phases. The Stats screen is illustrative, not the complete release stats inventory.

## Preview locally

Serve the repository root with any static HTTP server, for example:

```sh
python3 -m http.server 4173 --bind 0.0.0.0
```

Then open `http://localhost:4173` in a browser. The app is designed mobile-first; use a phone-sized viewport to review the visual direction and flows.
