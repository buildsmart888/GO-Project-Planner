# GO Project Planner

Browser-based construction project planning and control. Pilot release 0.7.
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

The build creates `dist/` and a standalone HTML file. Create `dist/` first on a clean checkout (`mkdir dist`).

## Important limitations

Data is stored in each browser, not a shared cloud database. Back up regularly. Calendar-day scheduling only: working calendars, zero-duration milestones and actual-driven forecasting are not implemented yet. Actual dates are tracking fields. Monthly totals group weekly periods by their ending month. Feedback downloads locally; it is not sent automatically.

## Contributing

Open an issue describing the expected behavior and reproduction steps. Submit changes in a pull request and keep scheduler tests passing. Never commit real project data, backup files, credentials or personal information.

## License

Licensed under the [MIT License](LICENSE). You may use, modify, redistribute and use commercially, provided the copyright and permission notice are retained. The software is provided as-is without warranty.
