# GO Project Planner

Browser-based construction project planning and control. Pilot release 0.9.
<img width="1763" height="1495" alt="image" src="https://github.com/user-attachments/assets/05fd13be-aada-418e-8f48-c7837e58c452" />
<img width="1763" height="3273" alt="image" src="https://github.com/user-attachments/assets/3ed6fe93-a823-4cfc-a728-fcc99c3c242d" />



## Run locally

Open `index.html` in a modern browser, or serve this directory with a local HTTP server. No external dependencies are required.

## Features

- CPM dependencies FS/FF/SS/SF, lag/lead and multiple predecessors
- Gantt, WBS collapse, critical-path network, baseline and Kanban
- Weekly/monthly horizontal progress matrix and S-curve
- Resource histogram and 3-week look ahead
- Microsoft Project XML import and JSON/CSV export
- Multiple local projects, backup/restore, undo/redo
- Actual Start/Finish recording, validation and print options

## Development

`node --check app.js`

`node tests/scheduler.test.js`

`node build-static.cjs`

The build creates `dist/` and a standalone HTML file.

## Important limitations

Data is stored in each browser, not a shared cloud database. Back up regularly. Monthly totals group weekly periods by their ending month. Feedback downloads locally; it is not sent automatically.

## Pilot 0.8 — calendars, milestones and forecast

Durations and lags use the selected project calendar (7 days, Monday–Saturday, or Monday–Friday), excluding manually entered holidays. Total Float is measured in working days; network indices are calendar-day offsets from project start.

- Zero-duration milestones, drawn as diamonds; FS after a milestone can start on the milestone date.
- Optional forecast in Project settings: completed tasks retain Actual Start/Finish; started tasks retain Actual Start and calculate finish from Remaining Duration starting at Data Date. Blank Remaining Duration is estimated from progress. Unstarted tasks move no earlier than Data Date.
- Actual dates overriding dependencies generate warnings rather than rewriting historical facts.
- Main navigation, table labels and controls support Thai/English. Detailed validation messages and some legacy dialogs remain bilingual/English.
- One shared project calendar only. Imported Microsoft Project per-task/resource calendars are not supported. Actual historical dates can be non-working days.
- Forecast is a simple remaining-duration forecast, not full retained-logic/resource-leveling scheduling. Review out-of-sequence work before contractual use.
- Browser-local storage only; backup regularly. Feedback is downloaded, not sent automatically.

Run `node tests/scheduler.test.js` to verify dependency, calendar, holiday, milestone and forecast cases.

## Contributing

Open an issue describing the expected behavior and reproduction steps. Submit changes in a pull request and keep scheduler tests passing. Never commit real project data, backup files, credentials or personal information.

## License

Licensed under the [MIT License](LICENSE). You may use, modify, redistribute and use commercially, provided the copyright and permission notice are retained. The software is provided as-is without warranty.


## Pilot 0.9 — site reporting


- A4/A3 landscape print layout fits the full Gantt and horizontal progress table together, with fit-page or fit-width options. Visible WBS rows/columns are respected. Enable background graphics in the browser when needed. Very large reports require filtering/collapsing WBS for legible text.
- The **Actual รายสัปดาห์** button records cumulative progress and actual cost by period-end date. Re-enter a date to correct it, or load/delete a record. Cumulative values must not decrease across records. Undo and JSON backups include history.
- Actual curves hold dated observations rather than inventing interpolated history. Tasks without records use a single snapshot at Data Date. Weekly increments roll into the month containing the week-end; actual earned value and actual cash cost are separate rows. Zero-budget projects use duration weights for progress, not fictitious currency values.
- XML preview shows task/WBS, source dates versus calculated dates, relationship types and Baseline 0 before replacement. Changing the common calendar recalculates comparison dates. The prior project backup downloads before importing.
- MS Project task/resource calendars, calendar exceptions, constraints and timephased actual data are not imported. Assignment units require manual review before treating them as manpower. Fractional lag is rounded with a warning; missing predecessors are reported.
- Look Ahead includes unfinished overdue tasks, owner/critical/constraint filters, constraint owner/due date, and a printable coordination register. Dependency checks are advisory; lag/lead and out-of-sequence work need human review.
- Resource Histogram supports date/team filters and daily concurrent overload details. Workdays, zero manpower and milestones are respected; Summary tasks are excluded from progress/cost/resource totals to avoid double counting. No automatic resource leveling.
- Validation: scheduler, dated actuals, weekly/monthly reconciliation, summary exclusion and XML mapping tests pass in UTC and Asia/Bangkok. The supplied Master Plan XML was checked (261 tasks, 57 summaries). Browser visual/print-preview QA could not run on this static project in the current managed preview environment; verify real browser Print Preview before contractual issue.



## Pilot 0.9.1 — print reliability

- Schedule print rendering is independent from the current on-screen Gantt zoom. A4/A3 choose a dedicated print timeline density.
- Fit Page is guarded by a minimum readability scale. If fitting Gantt + progress summary onto one page would shrink below the threshold, printing automatically switches to Fit Width.
- Fit Page uses a scaled print-stage wrapper; Fit Width keeps vertical pagination for long task lists.
- Gantt rows are protected from page breaks where supported by the browser. Visible rows still respect search, WBS collapse and critical-only filters.
- Browser Print Preview remains the final visual gate for Background graphics, margins and PDF output.
