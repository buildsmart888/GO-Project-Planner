# GO Project Planner

Browser-based construction project planning and control. Pilot release 0.8.
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
